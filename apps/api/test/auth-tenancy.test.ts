import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { CourseSession } from "../src/domain.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PrismaRepository } from "../src/prisma-repository.js";

const apps: ReturnType<typeof buildApp>[] = [];
const session: CourseSession = {
  id: "session-a",
  courseId: "course-a",
  courseName: "编程",
  campusId: "campus-a",
  campusName: "A 校区",
  classroomId: "room-a",
  classroomName: "101",
  teacherId: "teacher-a",
  teacherName: "王老师",
  startsAt: new Date("2026-09-02T10:00:00.000Z"),
  endsAt: new Date("2026-09-02T11:00:00.000Z"),
  capacity: 10,
  status: "PUBLISHED",
  bookingOpensAt: new Date("2026-08-20T00:00:00.000Z"),
  bookingClosesAt: new Date("2026-09-02T08:00:00.000Z"),
  cancelDeadlineAt: new Date("2026-09-02T06:00:00.000Z"),
};

function createApp() {
  const repository = new MemoryRepository({
    organizations: ["org-a", "org-b"],
    users: [
      { id: "admin-a", organizationId: "org-a", role: "ADMIN" },
      { id: "teacher-a", organizationId: "org-a", role: "TEACHER" },
      { id: "guardian-a", organizationId: "org-a", role: "GUARDIAN" },
      { id: "admin-b", organizationId: "org-b", role: "ADMIN" },
    ],
    students: [
      { id: "student-a", name: "学生甲", guardianPhone: "138****0001", organizationId: "org-a" },
      { id: "student-b", name: "学生乙", guardianPhone: "138****0002", organizationId: "org-a" },
    ],
    guardians: [
      { organizationId: "org-a", guardianId: "guardian-a", studentId: "student-a" },
    ],
    sessions: [
      { ...session, organizationId: "org-a" },
      { ...session, id: "session-b", organizationId: "org-b" },
    ],
    bookings: [
      {
        id: "booking-a",
        organizationId: "org-a",
        sessionId: "session-a",
        studentId: "student-a",
        status: "CONFIRMED",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ],
  });
  const app = buildApp(repository, { developmentIdentityEnabled: true });
  apps.push(app);
  return app;
}

function headers(
  tenant = "org-a",
  role = "ADMIN",
  userId = "admin-a",
) {
  return {
    "x-tenant-id": tenant,
    "x-role": role,
    "x-user-id": userId,
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("开发身份中间件与授权", () => {
  it("health 无需身份头，业务接口缺少身份头返回 401", async () => {
    const app = createApp();

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const response = await app.inject({ method: "GET", url: "/sessions" });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("DEVELOPMENT_IDENTITY_REQUIRED");
  });

  it("拒绝伪造角色和非本机构用户", async () => {
    const app = createApp();
    const roleMismatch = await app.inject({
      method: "GET",
      url: "/sessions",
      headers: headers("org-a", "ADMIN", "teacher-a"),
    });
    const crossTenant = await app.inject({
      method: "GET",
      url: "/sessions",
      headers: headers("org-b", "ADMIN", "admin-a"),
    });

    expect(roleMismatch.statusCode).toBe(403);
    expect(roleMismatch.json().error.code).toBe("ROLE_MISMATCH");
    expect(crossTenant.statusCode).toBe(401);
    expect(crossTenant.json().error.code).toBe("IDENTITY_NOT_FOUND");
  });

  it("老师只能为自己创建课次", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: {
        ...headers("org-a", "TEACHER", "teacher-a"),
        "content-type": "application/json",
      },
      payload: {
        courseId: "course-a",
        courseName: "编程",
        campusId: "campus-a",
        campusName: "A 校区",
        teacherId: "teacher-other",
        teacherName: "其他老师",
        startsAt: "2026-09-03T10:00:00.000Z",
        endsAt: "2026-09-03T11:00:00.000Z",
        capacity: 10,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TEACHER_SCOPE_FORBIDDEN");
  });

  it("家长只能为关联学生预约", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/sessions/session-a/bookings",
      headers: {
        ...headers("org-a", "GUARDIAN", "guardian-a"),
        "content-type": "application/json",
      },
      payload: { studentId: "student-b" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("STUDENT_FORBIDDEN");
  });

  it("课次列表按机构隔离", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/sessions",
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].id).toBe("session-a");
  });
});

describe("PrismaRepository.withSessionLock", () => {
  it("先执行租户范围的 FOR UPDATE，并让 action 复用同一事务客户端", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "session-a" }]),
      organization: { count: vi.fn().mockResolvedValue(1) },
    };
    const prisma = {
      organization: {
        count: vi.fn(() => {
          throw new Error("不应使用事务外客户端");
        }),
      },
      $transaction: vi.fn(async (action: (client: typeof transaction) => Promise<unknown>) =>
        action(transaction),
      ),
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);

    const result = await repository.withSessionLock("org-a", "session-a", () =>
      repository.organizationExists("org-a"),
    );

    expect(result).toBe(true);
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.organization.count).toHaveBeenCalledWith({
      where: { id: "org-a" },
    });
  });
});

describe("课次运营 API", () => {
  it("管理员调课后向预约家长发送通知，家长可标记已读", async () => {
    const app = createApp();
    const rescheduled = await app.inject({
      method: "PATCH",
      url: "/sessions/session-a/reschedule",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {
        startsAt: "2026-09-03T10:00:00.000Z",
        endsAt: "2026-09-03T11:00:00.000Z",
      },
    });
    expect(rescheduled.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/notifications?unreadOnly=true",
      headers: headers("org-a", "GUARDIAN", "guardian-a"),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);

    const notificationId = listed.json().data[0].id as string;
    const read = await app.inject({
      method: "PATCH",
      url: `/notifications/${notificationId}/read`,
      headers: headers("org-a", "GUARDIAN", "guardian-a"),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.readAt).not.toBeNull();
  });

  it("老师只能停掉自己的课次，停课批量取消预约", async () => {
    const app = createApp();
    const forbidden = await app.inject({
      method: "POST",
      url: "/sessions/session-b/cancel",
      headers: {
        ...headers("org-a", "TEACHER", "teacher-a"),
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);

    const cancelled = await app.inject({
      method: "POST",
      url: "/sessions/session-a/cancel",
      headers: {
        ...headers("org-a", "TEACHER", "teacher-a"),
        "content-type": "application/json",
      },
      payload: { reason: "临时停课" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data.status).toBe("CANCELLED");
  });

  it("老师可登记请假且家长不可访问审计日志", async () => {
    const app = createApp();
    const attendance = await app.inject({
      method: "PUT",
      url: "/sessions/session-a/attendance",
      headers: {
        ...headers("org-a", "TEACHER", "teacher-a"),
        "content-type": "application/json",
      },
      payload: { records: [{ bookingId: "booking-a", status: "LEAVE" }] },
    });
    expect(attendance.statusCode).toBe(200);
    expect(attendance.json().data[0].status).toBe("LEAVE");

    const forbidden = await app.inject({
      method: "GET",
      url: "/audit-logs",
      headers: headers("org-a", "GUARDIAN", "guardian-a"),
    });
    expect(forbidden.statusCode).toBe(403);

    const logs = await app.inject({
      method: "GET",
      url: "/audit-logs",
      headers: headers(),
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().data[0]).toMatchObject({
      actorId: "teacher-a",
      action: "ATTENDANCE_UPDATED",
    });
  });
});
