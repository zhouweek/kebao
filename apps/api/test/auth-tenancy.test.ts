import { Prisma, PrismaClient } from "@prisma/client";
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

  it("家长只能读取本人绑定的学生", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/guardian/students",
      headers: headers("org-a", "GUARDIAN", "guardian-a"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      { id: "student-a", name: "学生甲" },
    ]);
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

  it("老师查询课表时服务端强制限定本人，忽略传入的其他老师", async () => {
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      users: [
        { id: "teacher-a", organizationId: "org-a", role: "TEACHER" },
        { id: "teacher-other", organizationId: "org-a", role: "TEACHER" },
      ],
      sessions: [
        { ...session, organizationId: "org-a" },
        {
          ...session,
          id: "session-other",
          teacherId: "teacher-other",
          teacherName: "李老师",
          organizationId: "org-a",
        },
      ],
    });
    const app = buildApp(repository, { developmentIdentityEnabled: true });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/sessions?teacherId=teacher-other",
      headers: headers("org-a", "TEACHER", "teacher-a"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((item: { id: string }) => item.id)).toEqual([
      "session-a",
    ]);
  });
});

describe("老师排课基础资料", () => {
  function createTeacherApp() {
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      users: [
        {
          id: "teacher-a",
          organizationId: "org-a",
          role: "TEACHER",
          name: "王老师",
        },
      ],
      masterData: {
        courses: [
          {
            id: "course-active",
            organizationId: "org-a",
            name: "启用课程",
            durationMinutes: 60,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "course-disabled",
            organizationId: "org-a",
            name: "停用课程",
            durationMinutes: 60,
            isActive: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        campuses: [
          {
            id: "campus-a",
            organizationId: "org-a",
            name: "A 校区",
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "campus-b",
            organizationId: "org-a",
            name: "B 校区",
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        classrooms: [
          {
            id: "room-a",
            organizationId: "org-a",
            name: "A101",
            campusId: "campus-a",
            capacity: 12,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    const app = buildApp(repository, { developmentIdentityEnabled: true });
    apps.push(app);
    return app;
  }

  it("options 仅返回启用的当前机构基础资料和当前老师", async () => {
    const response = await createTeacherApp().inject({
      method: "GET",
      url: "/teacher/options",
      headers: headers("org-a", "TEACHER", "teacher-a"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.teacher).toEqual({ id: "teacher-a", name: "王老师" });
    expect(response.json().data.courses.map((item: { id: string }) => item.id)).toEqual([
      "course-active",
    ]);
    expect(response.json().data.classrooms[0]).toMatchObject({
      id: "room-a",
      campusId: "campus-a",
    });
  });

  it("老师创建课次时使用服务端基础资料名称并校验教室归属", async () => {
    const app = createTeacherApp();
    const basePayload = {
      courseId: "course-active",
      courseName: "伪造课程名",
      campusId: "campus-a",
      campusName: "伪造校区名",
      classroomId: "room-a",
      classroomName: "伪造教室名",
      teacherId: "teacher-a",
      teacherName: "伪造老师名",
      startsAt: "2026-09-04T02:00:00.000Z",
      endsAt: "2026-09-04T03:00:00.000Z",
      capacity: 10,
    };
    const created = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { ...headers("org-a", "TEACHER", "teacher-a"), "content-type": "application/json" },
      payload: basePayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      courseName: "启用课程",
      campusName: "A 校区",
      classroomName: "A101",
      teacherName: "王老师",
    });

    const wrongCampus = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { ...headers("org-a", "TEACHER", "teacher-a"), "content-type": "application/json" },
      payload: {
        ...basePayload,
        campusId: "campus-b",
        startsAt: "2026-09-05T02:00:00.000Z",
        endsAt: "2026-09-05T03:00:00.000Z",
      },
    });
    expect(wrongCampus.statusCode).toBe(400);
    expect(wrongCampus.json().error.code).toBe("CLASSROOM_UNAVAILABLE");
  });

  it("老师创建课次时拒绝停用课程", async () => {
    const response = await createTeacherApp().inject({
      method: "POST",
      url: "/sessions",
      headers: { ...headers("org-a", "TEACHER", "teacher-a"), "content-type": "application/json" },
      payload: {
        courseId: "course-disabled",
        courseName: "停用课程",
        campusId: "campus-a",
        campusName: "A 校区",
        teacherId: "teacher-a",
        teacherName: "王老师",
        startsAt: "2026-09-04T02:00:00.000Z",
        endsAt: "2026-09-04T03:00:00.000Z",
        capacity: 10,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("COURSE_UNAVAILABLE");
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

  it("withTransaction 让系列内所有写入复用同一事务客户端", async () => {
    const transaction = {
      scheduleSeries: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      scheduleSeries: {
        findFirst: vi.fn(() => {
          throw new Error("不应使用事务外客户端");
        }),
      },
      $transaction: vi.fn(async (action: (client: typeof transaction) => Promise<unknown>) =>
        action(transaction),
      ),
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);

    const result = await repository.withTransaction(() =>
      repository.getSeries("org-a", "series-a"),
    );

    expect(result).toBeUndefined();
    expect(transaction.scheduleSeries.findFirst).toHaveBeenCalledWith({
      where: { id: "series-a", organizationId: "org-a" },
    });
  });

  it("withTransaction 遇到 P2034 时有界重试且嵌套调用复用当前事务", async () => {
    const transaction = {
      scheduleSeries: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const conflict = () =>
      new Prisma.PrismaClientKnownRequestError("transaction write conflict", {
        code: "P2034",
        clientVersion: "test",
      });
    let attempts = 0;
    const prisma = {
      $transaction: vi.fn(
        async (action: (client: typeof transaction) => Promise<unknown>) => {
          attempts += 1;
          const result = await action(transaction);
          if (attempts < 3) throw conflict();
          return result;
        },
      ),
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);

    const result = await repository.withTransaction(() =>
      repository.withTransaction(() => repository.getSeries("org-a", "series-a")),
    );

    expect(result).toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(transaction.scheduleSeries.findFirst).toHaveBeenCalledTimes(3);
  });

  it("withTransaction 在 P2034 达到重试上限后抛出原错误", async () => {
    const conflict = () =>
      new Prisma.PrismaClientKnownRequestError("transaction write conflict", {
        code: "P2034",
        clientVersion: "test",
      });
    const action = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      $transaction: vi.fn(
        async (transactionAction: (client: object) => Promise<unknown>) => {
          await transactionAction({});
          throw conflict();
        },
      ),
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);

    await expect(repository.withTransaction(action)).rejects.toMatchObject({
      code: "P2034",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(action).toHaveBeenCalledTimes(3);
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

describe("管理员预约 API", () => {
  it("分页筛选预约并返回课程、学生和老师信息", async () => {
    const app = createApp();

    const response = await app.inject({
      method: "GET",
      url: "/admin/bookings?page=1&pageSize=1&sessionId=session-a&studentId=student-a&status=CONFIRMED&from=2026-09-02T00%3A00%3A00.000Z&to=2026-09-03T00%3A00%3A00.000Z",
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      items: [
        {
          id: "booking-a",
          session: {
            id: "session-a",
            courseId: "course-a",
            courseName: "编程",
            startsAt: "2026-09-02T10:00:00.000Z",
          },
          student: {
            id: "student-a",
            name: "学生甲",
            guardianPhone: "138****0001",
          },
          teacher: { id: "teacher-a", name: "王老师" },
        },
      ],
    });
  });

  it("仅管理员可查询和代操作预约", async () => {
    const app = createApp();

    const listed = await app.inject({
      method: "GET",
      url: "/admin/bookings",
      headers: headers("org-a", "GUARDIAN", "guardian-a"),
    });
    const created = await app.inject({
      method: "POST",
      url: "/admin/bookings",
      headers: {
        ...headers("org-a", "GUARDIAN", "guardian-a"),
        "content-type": "application/json",
      },
      payload: { sessionId: "session-a", studentId: "student-b" },
    });

    expect(listed.statusCode).toBe(403);
    expect(created.statusCode).toBe(403);
  });

  it("管理员可在预约截止后代预约，并校验分页参数", async () => {
    const app = createApp();

    const created = await app.inject({
      method: "POST",
      url: "/admin/bookings",
      headers: { ...headers(), "content-type": "application/json" },
      payload: { sessionId: "session-a", studentId: "student-b" },
    });
    const invalidPage = await app.inject({
      method: "GET",
      url: "/admin/bookings?page=0",
      headers: headers(),
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().data.booking).toMatchObject({
      sessionId: "session-a",
      studentId: "student-b",
      status: "CONFIRMED",
    });
    expect(invalidPage.statusCode).toBe(400);
    expect(invalidPage.json().error.code).toBe("INVALID_PAGINATION");
  });

  it("代取消要求原因、越过家长截止时间并写入审计日志", async () => {
    const app = createApp();
    const missingReason = await app.inject({
      method: "POST",
      url: "/admin/bookings/booking-a/cancel",
      headers: { ...headers(), "content-type": "application/json" },
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);

    const cancelled = await app.inject({
      method: "POST",
      url: "/admin/bookings/booking-a/cancel",
      headers: { ...headers(), "content-type": "application/json" },
      payload: { reason: "家长电话申请" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data.status).toBe("CANCELLED");

    const logs = await app.inject({
      method: "GET",
      url: "/audit-logs",
      headers: headers(),
    });
    expect(logs.json().data[0]).toMatchObject({
      actorId: "admin-a",
      action: "ADMIN_BOOKING_CANCELLED",
      entityId: "booking-a",
      details: { reason: "家长电话申请" },
    });
  });
});
