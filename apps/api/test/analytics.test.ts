import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsService } from "../src/analytics.js";
import { buildApp } from "../src/app.js";
import type { Booking, CourseSession } from "../src/domain.js";
import { MemoryRepository } from "../src/memory-repository.js";

const generatedAt = new Date("2026-09-03T12:00:00.000Z");
const apps: ReturnType<typeof buildApp>[] = [];

function session(
  id: string,
  overrides: Partial<CourseSession & { organizationId: string }> = {},
): CourseSession & { organizationId: string } {
  return {
    id,
    organizationId: "org-a",
    courseId: "course-a",
    courseName: "少儿编程",
    campusId: "campus-a",
    campusName: "中心校区",
    classroomId: "room-a",
    classroomName: "101",
    teacherId: "teacher-a",
    teacherName: "王老师",
    startsAt: new Date("2026-09-10T02:00:00.000Z"),
    endsAt: new Date("2026-09-10T03:00:00.000Z"),
    capacity: 10,
    status: "FINISHED",
    bookingOpensAt: new Date("2026-09-01T00:00:00.000Z"),
    bookingClosesAt: new Date("2026-09-10T00:00:00.000Z"),
    cancelDeadlineAt: new Date("2026-09-09T22:00:00.000Z"),
    ...overrides,
  };
}

function booking(
  id: string,
  sessionId: string,
  status: Booking["status"],
  studentId = id,
): Booking & { organizationId: string } {
  return {
    id,
    organizationId: "org-a",
    sessionId,
    studentId,
    status,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

function repository() {
  return new MemoryRepository({
    organizations: ["org-a", "org-b"],
    users: [
      { id: "admin-a", organizationId: "org-a", role: "ADMIN" },
      { id: "teacher-a", organizationId: "org-a", role: "TEACHER" },
      { id: "admin-b", organizationId: "org-b", role: "ADMIN" },
    ],
    students: [
      {
        id: "student-attended",
        organizationId: "org-a",
        name: "=危险公式",
        guardianPhone: "13812345678",
      },
      {
        id: "student-absent",
        organizationId: "org-a",
        name: "学生乙",
        guardianPhone: "",
      },
      {
        id: "student-cancelled",
        organizationId: "org-a",
        name: "学生丙",
        guardianPhone: "",
      },
    ],
    sessions: [
      session("session-a"),
      session("session-b", {
        courseId: "course-b",
        courseName: "机器人",
        campusId: "campus-b",
        campusName: "北校区",
        teacherId: "teacher-b",
        teacherName: "李老师",
        capacity: 5,
        startsAt: new Date("2026-09-11T02:00:00.000Z"),
        endsAt: new Date("2026-09-11T03:00:00.000Z"),
      }),
      session("session-draft", { status: "DRAFT" }),
      session("session-cancelled", { status: "CANCELLED" }),
      session("session-other-tenant", {
        organizationId: "org-b",
        courseName: "其他机构课程",
      }),
    ],
    bookings: [
      booking("booking-attended", "session-a", "ATTENDED", "student-attended"),
      booking("booking-absent", "session-a", "ABSENT", "student-absent"),
      booking("booking-cancelled", "session-a", "CANCELLED", "student-cancelled"),
      booking("booking-course-cancelled", "session-a", "COURSE_CANCELLED"),
      booking("booking-confirmed", "session-b", "CONFIRMED"),
      booking("booking-draft", "session-draft", "CONFIRMED"),
      booking("booking-other-tenant", "session-other-tenant", "CONFIRMED"),
    ],
  });
}

function headers(tenant = "org-a", role = "ADMIN", user = "admin-a") {
  return {
    "x-tenant-id": tenant,
    "x-role": role,
    "x-user-id": user,
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("AnalyticsService.getStatistics", () => {
  it("按统一口径排除草稿、停课和课程取消，并按合计分母计算指标", async () => {
    const service = new AnalyticsService(
      repository(),
      "org-a",
      "admin-a",
      () => generatedAt,
    );

    const result = await service.getStatistics({});

    expect(result.metrics).toEqual({
      sessionCount: 2,
      reservationCount: 4,
      occupancyRate: 20,
      cancellationRate: 25,
      attendanceRate: 50,
    });
    expect(result.details.map((item) => item.sessionId)).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(result.details[0]).toMatchObject({
      reservationCount: 3,
      activeBookingCount: 2,
      cancelledBookingCount: 1,
      attendanceRate: 50,
    });
  });

  it("同时应用时间、校区、课程和老师筛选，空分母返回零", async () => {
    const service = new AnalyticsService(repository(), "org-a", "admin-a");

    const result = await service.getStatistics({
      from: new Date("2026-09-11T00:00:00.000Z"),
      to: new Date("2026-09-12T00:00:00.000Z"),
      campusId: "campus-b",
      courseId: "course-b",
      teacherId: "teacher-b",
    });

    expect(result.details).toHaveLength(1);
    expect(result.details[0]?.sessionId).toBe("session-b");
    expect(result.metrics).toMatchObject({
      sessionCount: 1,
      reservationCount: 1,
      occupancyRate: 20,
      cancellationRate: 0,
      attendanceRate: 0,
    });
  });

  it("拒绝倒置的时间范围", async () => {
    const service = new AnalyticsService(repository(), "org-a", "admin-a");

    await expect(
      service.getStatistics({
        from: new Date("2026-09-12T00:00:00.000Z"),
        to: new Date("2026-09-11T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_TIME_RANGE", statusCode: 400 });
  });
});

describe("AnalyticsService.exportCsv", () => {
  it("输出带 BOM、筛选条件、生成时间、口径和明细的 CSV，并记录导出审计", async () => {
    const repo = repository();
    const service = new AnalyticsService(
      repo,
      "org-a",
      "admin-a",
      () => generatedAt,
      () => "export-1",
    );

    const result = await service.exportCsv({ courseId: "course-a" });

    expect(result.filename).toBe("statistics-details-2026-09-03T12-00-00-000Z.csv");
    expect(result.csv.startsWith("\uFEFF")).toBe(true);
    expect(result.csv).toContain('"生成时间","2026-09-03T12:00:00.000Z"');
    expect(result.csv).toContain('"筛选条件","courseId=course-a"');
    expect(result.csv).toContain('"口径说明","课次数仅统计已发布');
    expect(result.csv).toContain(`"'=危险公式"`);
    expect(result.csv).toContain('"家长手机号（脱敏）"');
    expect(result.csv).toContain('"138****5678"');
    expect(result.csv).not.toContain("13812345678");
    expect(result.csv).not.toContain("booking-course-cancelled");
    expect(result.csv).not.toContain("其他机构课程");
    await expect(repo.listAuditLogs("org-a")).resolves.toEqual([
      expect.objectContaining({
        action: "STATISTICS_CSV_EXPORTED",
        actorId: "admin-a",
        entityId: "export-1",
        details: expect.objectContaining({
          filter: expect.objectContaining({ courseId: "course-a" }),
          rowCount: 3,
        }),
      }),
    ]);
    await expect(repo.listAuditLogs("org-b")).resolves.toEqual([]);
  });
});

describe("管理员统计 API", () => {
  it("仅允许管理员访问，并按当前身份的机构隔离统计数据", async () => {
    const app = buildApp(repository(), {
      developmentIdentityEnabled: true,
      now: () => generatedAt,
    });
    apps.push(app);

    const teacher = await app.inject({
      method: "GET",
      url: "/admin/statistics",
      headers: headers("org-a", "TEACHER", "teacher-a"),
    });
    const tenantA = await app.inject({
      method: "GET",
      url: "/admin/statistics",
      headers: headers(),
    });
    const tenantB = await app.inject({
      method: "GET",
      url: "/admin/statistics",
      headers: headers("org-b", "ADMIN", "admin-b"),
    });

    expect(teacher.statusCode).toBe(403);
    expect(tenantA.json().data.metrics.sessionCount).toBe(2);
    expect(tenantB.json().data.metrics.sessionCount).toBe(1);
    expect(JSON.stringify(tenantB.json())).not.toContain("session-a");
  });

  it("导出返回 UTF-8 CSV 下载头且只在当前机构写审计", async () => {
    const repo = repository();
    const app = buildApp(repo, {
      developmentIdentityEnabled: true,
      now: () => generatedAt,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/admin/statistics/export?courseId=course-a",
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain(
      "statistics-details-2026-09-03T12-00-00-000Z.csv",
    );
    expect(response.body.startsWith("\uFEFF")).toBe(true);
    expect(response.body).not.toContain("其他机构课程");
    expect(await repo.listAuditLogs("org-a")).toHaveLength(1);
    expect(await repo.listAuditLogs("org-b")).toHaveLength(0);
  });
});
