import { describe, expect, it } from "vitest";
import {
  DomainError,
  SchedulingService,
  type Booking,
  type CourseSession,
  type Student,
} from "../src/domain.js";
import { MemoryRepository } from "../src/memory-repository.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");

const students: Student[] = [
  { id: "student-1", name: "学生甲", guardianPhone: "138****0001" },
  { id: "student-2", name: "学生乙", guardianPhone: "138****0002" },
];

function makeSession(overrides: Partial<CourseSession> = {}): CourseSession {
  return {
    id: "session-1",
    courseId: "course-1",
    courseName: "少儿编程",
    campusId: "campus-1",
    campusName: "中心校区",
    classroomId: "room-1",
    classroomName: "101",
    teacherId: "teacher-1",
    teacherName: "王老师",
    startsAt: new Date("2026-09-02T10:00:00.000Z"),
    endsAt: new Date("2026-09-02T11:00:00.000Z"),
    capacity: 2,
    status: "PUBLISHED",
    bookingOpensAt: new Date("2026-08-26T10:00:00.000Z"),
    bookingClosesAt: new Date("2026-09-02T08:00:00.000Z"),
    cancelDeadlineAt: new Date("2026-09-02T06:00:00.000Z"),
    ...overrides,
  };
}

function createService(options?: {
  sessions?: CourseSession[];
  bookings?: Booking[];
  now?: Date;
}) {
  let sequence = 0;
  const repository = new MemoryRepository({
    students,
    sessions: options?.sessions ?? [makeSession()],
    bookings: options?.bookings ?? [],
  });
  const service = new SchedulingService(
    repository,
    () => options?.now ?? NOW,
    () => `generated-${++sequence}`,
  );
  return { repository, service };
}

describe("SchedulingService.createSession", () => {
  it("拒绝老师时间冲突", async () => {
    const { service } = createService();

    await expect(
      service.createSession({
        courseId: "course-2",
        courseName: "机器人",
        campusId: "campus-1",
        campusName: "中心校区",
        classroomId: "room-2",
        classroomName: "102",
        teacherId: "teacher-1",
        teacherName: "王老师",
        startsAt: new Date("2026-09-02T10:30:00.000Z"),
        endsAt: new Date("2026-09-02T11:30:00.000Z"),
        capacity: 10,
      }),
    ).rejects.toMatchObject({
      code: "SESSION_CONFLICT",
      statusCode: 409,
    });
  });

  it("允许与草稿课次时间重叠", async () => {
    const { service } = createService({
      sessions: [makeSession({ status: "DRAFT" })],
    });

    const created = await service.createSession({
      courseId: "course-2",
      courseName: "机器人",
      campusId: "campus-1",
      campusName: "中心校区",
      classroomId: "room-1",
      classroomName: "101",
      teacherId: "teacher-1",
      teacherName: "王老师",
      startsAt: new Date("2026-09-02T10:30:00.000Z"),
      endsAt: new Date("2026-09-02T11:30:00.000Z"),
      capacity: 10,
    });

    expect(created.id).toBe("generated-1");
    expect(created.status).toBe("PUBLISHED");
  });
});

describe("SchedulingService schedule series", () => {
  const seriesInput = {
    courseId: "course-2",
    courseName: "机器人",
    campusId: "campus-1",
    campusName: "中心校区",
    classroomId: "room-2",
    classroomName: "102",
    teacherId: "teacher-2",
    teacherName: "李老师",
    startsAt: new Date("2026-09-03T10:00:00.000Z"),
    endsAt: new Date("2026-09-03T11:00:00.000Z"),
    capacity: 10,
    recurrence: "WEEKLY" as const,
    intervalWeeks: 1,
    repeatCount: 3,
  };

  it("按周和指定次数创建系列并写入序号", async () => {
    const { service } = createService({ sessions: [] });

    const result = await service.createSeries(seriesInput);

    expect(result.sessions).toHaveLength(3);
    expect(result.successDates).toEqual(["2026-09-03", "2026-09-10", "2026-09-17"]);
    expect(result.sessions.map((item) => item.occurrenceIndex)).toEqual([0, 1, 2]);
    expect(new Set(result.sessions.map((item) => item.seriesId))).toEqual(
      new Set([result.series?.id]),
    );
  });

  it("预检返回冲突日期且默认整批不落库", async () => {
    const conflict = makeSession({
      id: "conflict",
      teacherId: "teacher-2",
      classroomId: "room-other",
      startsAt: new Date("2026-09-10T10:00:00.000Z"),
      endsAt: new Date("2026-09-10T11:00:00.000Z"),
    });
    const { repository, service } = createService({ sessions: [conflict] });

    const preview = await service.previewSeries(seriesInput);
    expect(preview.conflicts.map((item) => item.date)).toEqual(["2026-09-10"]);
    await expect(service.createSeries(seriesInput)).rejects.toMatchObject({
      code: "SERIES_CONFLICT",
      statusCode: 409,
    });
    await expect(repository.listSessions("org-development", {})).resolves.toEqual([
      conflict,
    ]);
  });

  it("显式跳过冲突时返回成功和冲突日期", async () => {
    const conflict = makeSession({
      id: "conflict",
      teacherId: "teacher-2",
      classroomId: "room-other",
      startsAt: new Date("2026-09-10T10:00:00.000Z"),
      endsAt: new Date("2026-09-10T11:00:00.000Z"),
    });
    const { service } = createService({ sessions: [conflict] });

    const result = await service.createSeries({ ...seriesInput, skipConflicts: true });

    expect(result.successDates).toEqual(["2026-09-03", "2026-09-17"]);
    expect(result.conflicts.map((item) => item.date)).toEqual(["2026-09-10"]);
  });

  it("仓储写入失败时回滚整个系列", async () => {
    class FailingRepository extends MemoryRepository {
      private saves = 0;
      override async saveSession(organizationId: string, value: CourseSession) {
        this.saves += 1;
        if (this.saves === 2) throw new Error("模拟数据库写入失败");
        return super.saveSession(organizationId, value);
      }
    }
    const repository = new FailingRepository();
    let sequence = 0;
    const service = new SchedulingService(
      repository,
      () => NOW,
      () => `transaction-${++sequence}`,
    );

    await expect(service.createSeries(seriesInput)).rejects.toThrow("模拟数据库写入失败");
    await expect(repository.listSessions("org-development", {})).resolves.toEqual([]);
    await expect(
      repository.getSeries("org-development", "transaction-1"),
    ).resolves.toBeUndefined();
  });

  it("并发创建相同系列时事务内预检只允许一批成功", async () => {
    const { service } = createService({ sessions: [] });

    const results = await Promise.allSettled([
      service.createSeries(seriesInput),
      service.createSeries(seriesInput),
    ]);

    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({ code: "SERIES_CONFLICT" });
  });

  it("系列数据按机构隔离", async () => {
    const repository = new MemoryRepository({
      organizations: ["org-a", "org-b"],
      sessions: [],
    });
    let sequence = 0;
    const serviceA = new SchedulingService(
      repository,
      () => NOW,
      () => `tenant-${++sequence}`,
      "org-a",
      "admin-a",
    );
    await serviceA.createSeries(seriesInput);

    await expect(repository.listSessions("org-b", {})).resolves.toEqual([]);
    await expect(repository.getSeries("org-b", "tenant-1")).resolves.toBeUndefined();
  });
});

describe("SchedulingService series operations", () => {
  function seriesSession(index: number, overrides: Partial<CourseSession> = {}) {
    const offset = index * 7 * 24 * 60 * 60 * 1000;
    return makeSession({
      id: `series-${index}`,
      seriesId: "series-1",
      occurrenceIndex: index,
      startsAt: new Date(new Date("2026-09-02T10:00:00.000Z").getTime() + offset),
      endsAt: new Date(new Date("2026-09-02T11:00:00.000Z").getTime() + offset),
      ...overrides,
    });
  }

  it("[defect-probing] 本次及以后调课拒绝无效时间范围", async () => {
    const { service } = createService({
      sessions: [seriesSession(0), seriesSession(1)],
    });

    await expect(
      service.rescheduleWithScope(
        "series-0",
        {
          startsAt: new Date("2026-09-03T12:00:00.000Z"),
          endsAt: new Date("2026-09-03T11:00:00.000Z"),
        },
        "THIS_AND_FUTURE",
      ),
    ).rejects.toMatchObject({ code: "INVALID_TIME_RANGE" });
  });

  it("[defect-probing] 本次及以后调课拒绝已有预约学生的时间冲突", async () => {
    const booking: Booking = {
      id: "booking-series",
      sessionId: "series-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const otherBooking: Booking = {
      id: "booking-other",
      sessionId: "student-conflict",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({
      sessions: [
        seriesSession(0),
        seriesSession(1),
        makeSession({
          id: "student-conflict",
          teacherId: "teacher-other",
          classroomId: "room-other",
          startsAt: new Date("2026-09-10T12:00:00.000Z"),
          endsAt: new Date("2026-09-10T13:00:00.000Z"),
        }),
      ],
      bookings: [booking, otherBooking],
    });

    await expect(
      service.rescheduleWithScope(
        "series-0",
        {
          startsAt: new Date("2026-09-03T12:00:00.000Z"),
          endsAt: new Date("2026-09-03T13:00:00.000Z"),
        },
        "THIS_AND_FUTURE",
      ),
    ).rejects.toMatchObject({ code: "STUDENT_TIME_CONFLICT" });
  });

  it("仅本次停课不影响后续，本次及以后停课批量生效", async () => {
    const first = createService({ sessions: [seriesSession(0), seriesSession(1)] });
    await first.service.cancelWithScope("series-0", "临时停课", "THIS");
    expect((await first.repository.getSession("org-development", "series-0"))?.status).toBe(
      "CANCELLED",
    );
    expect((await first.repository.getSession("org-development", "series-1"))?.status).toBe(
      "PUBLISHED",
    );

    const future = createService({
      sessions: [seriesSession(0), seriesSession(1), seriesSession(2)],
    });
    const cancelled = await future.service.cancelWithScope(
      "series-1",
      "后续停课",
      "THIS_AND_FUTURE",
    );
    expect(cancelled.map((item) => item.id)).toEqual(["series-1", "series-2"]);
    expect(cancelled.every((item) => item.status === "CANCELLED")).toBe(true);
  });
});

describe("SchedulingService.book", () => {
  it("重复预约幂等返回原预约", async () => {
    const existing: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({ bookings: [existing] });

    const result = await service.book("session-1", "student-1");

    expect(result).toEqual({ booking: existing, alreadyBooked: true });
  });

  it("并发抢最后一个名额时仅一个预约成功", async () => {
    const { service } = createService({
      sessions: [makeSession({ capacity: 1 })],
    });

    const results = await Promise.allSettled([
      service.book("session-1", "student-1"),
      service.book("session-1", "student-2"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejection?.reason).toMatchObject({ code: "SESSION_FULL" });
  });

  it("拒绝学生预约时间重叠的课次", async () => {
    const existingBooking: Booking = {
      id: "booking-other",
      sessionId: "session-other",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({
      sessions: [
        makeSession(),
        makeSession({
          id: "session-other",
          teacherId: "teacher-2",
          classroomId: "room-2",
          startsAt: new Date("2026-09-02T10:30:00.000Z"),
          endsAt: new Date("2026-09-02T11:30:00.000Z"),
        }),
      ],
      bookings: [existingBooking],
    });

    await expect(service.book("session-1", "student-1")).rejects.toMatchObject({
      code: "STUDENT_TIME_CONFLICT",
    });
  });
});

describe("SchedulingService.bookForAdmin", () => {
  it("[defect-probing] 截止预约后管理员仍可代预约", async () => {
    const { service } = createService({
      sessions: [makeSession({ status: "CLOSED" })],
      now: new Date("2026-09-02T09:00:00.000Z"),
    });

    const result = await service.bookForAdmin("session-1", "student-1");

    expect(result.alreadyBooked).toBe(false);
    expect(result.booking).toMatchObject({
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
    });
  });

  it("复用重复预约、容量和学生时间冲突规则", async () => {
    const existing: Booking = {
      id: "booking-existing",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({ bookings: [existing] });
    await expect(service.bookForAdmin("session-1", "student-1")).resolves.toEqual({
      booking: existing,
      alreadyBooked: true,
    });

    const full = createService({
      sessions: [makeSession({ capacity: 1 })],
      bookings: [existing],
    });
    await expect(full.service.bookForAdmin("session-1", "student-2")).rejects.toMatchObject({
      code: "SESSION_FULL",
    });

    const conflict = createService({
      sessions: [
        makeSession(),
        makeSession({
          id: "session-other",
          teacherId: "teacher-2",
          classroomId: "room-2",
          startsAt: new Date("2026-09-02T10:30:00.000Z"),
          endsAt: new Date("2026-09-02T11:30:00.000Z"),
        }),
      ],
      bookings: [{ ...existing, sessionId: "session-other" }],
    });
    await expect(
      conflict.service.bookForAdmin("session-1", "student-1"),
    ).rejects.toMatchObject({ code: "STUDENT_TIME_CONFLICT" });
  });
});

describe("SchedulingService.cancelBooking", () => {
  it("截止时间前取消并释放名额", async () => {
    const booking: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({ bookings: [booking] });

    const cancelled = await service.cancelBooking("booking-1");
    const sessions = await service.listSessions({});

    expect(cancelled.status).toBe("CANCELLED");
    expect(sessions[0]?.remainingCapacity).toBe(2);
  });

  it("截止时间后拒绝家长自助取消", async () => {
    const booking: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({
      bookings: [booking],
      now: new Date("2026-09-02T06:00:00.000Z"),
    });

    await expect(service.cancelBooking("booking-1")).rejects.toMatchObject({
      code: "CANCELLATION_DEADLINE_PASSED",
    });
  });
});

describe("SchedulingService.cancelBookingForAdmin", () => {
  it("[defect-probing] 越过家长截止时间并记录必填原因", async () => {
    const booking: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({
      bookings: [booking],
      now: new Date("2026-09-02T09:00:00.000Z"),
    });

    const cancelled = await service.cancelBookingForAdmin("booking-1", "  家长来电  ");

    expect(cancelled.status).toBe("CANCELLED");
    expect((await service.listAuditLogs())[0]).toMatchObject({
      action: "ADMIN_BOOKING_CANCELLED",
      entityId: "booking-1",
      details: {
        sessionId: "session-1",
        studentId: "student-1",
        reason: "家长来电",
      },
    });
  });

  it("拒绝空白代取消原因且不修改预约", async () => {
    const booking: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { repository, service } = createService({ bookings: [booking] });

    await expect(service.cancelBookingForAdmin("booking-1", "   ")).rejects.toMatchObject({
      code: "CANCELLATION_REASON_REQUIRED",
      statusCode: 400,
    });
    await expect(
      repository.getBooking("org-development", "booking-1"),
    ).resolves.toEqual(booking);
  });
});

describe("SchedulingService.getRoster", () => {
  it("只返回有效预约学生", async () => {
    const { service } = createService({
      bookings: [
        {
          id: "booking-1",
          sessionId: "session-1",
          studentId: "student-1",
          status: "CONFIRMED",
          createdAt: NOW,
        },
        {
          id: "booking-2",
          sessionId: "session-1",
          studentId: "student-2",
          status: "CANCELLED",
          createdAt: NOW,
        },
      ],
    });

    await expect(service.getRoster("session-1")).resolves.toEqual([
      { ...students[0], bookingId: "booking-1", bookingStatus: "CONFIRMED" },
    ]);
  });
});

describe("SchedulingService.rescheduleSession", () => {
  it("[defect-probing] 调课时同步平移预约时间窗", async () => {
    const { service } = createService();

    const updated = await service.rescheduleSession("session-1", {
      startsAt: new Date("2026-09-09T10:00:00.000Z"),
      endsAt: new Date("2026-09-09T11:00:00.000Z"),
    });

    expect(updated.bookingOpensAt).toEqual(new Date("2026-09-02T10:00:00.000Z"));
    expect(updated.bookingClosesAt).toEqual(new Date("2026-09-09T08:00:00.000Z"));
    expect(updated.cancelDeadlineAt).toEqual(new Date("2026-09-09T06:00:00.000Z"));
  });

  it("重新校验老师冲突且失败时不修改原课次", async () => {
    const original = makeSession();
    const { repository, service } = createService({
      sessions: [
        original,
        makeSession({
          id: "session-2",
          teacherId: "teacher-2",
          classroomId: "room-2",
          startsAt: new Date("2026-09-03T10:00:00.000Z"),
          endsAt: new Date("2026-09-03T11:00:00.000Z"),
        }),
      ],
    });

    await expect(
      service.rescheduleSession("session-1", {
        startsAt: new Date("2026-09-03T10:00:00.000Z"),
        endsAt: new Date("2026-09-03T11:00:00.000Z"),
        teacherId: "teacher-2",
      }),
    ).rejects.toMatchObject({ code: "SESSION_CONFLICT" });
    await expect(repository.getSession("org-development", "session-1")).resolves.toEqual(
      original,
    );
  });

  it("通知有效预约对应家长并记录审计", async () => {
    const booking: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const repository = new MemoryRepository({
      users: [
        { id: "guardian-1", organizationId: "org-development", role: "GUARDIAN" },
      ],
      guardians: [
        {
          organizationId: "org-development",
          guardianId: "guardian-1",
          studentId: "student-1",
        },
      ],
      students,
      sessions: [makeSession()],
      bookings: [booking],
    });
    const service = new SchedulingService(
      repository,
      () => NOW,
      (() => {
        let id = 0;
        return () => `id-${++id}`;
      })(),
      "org-development",
      "admin-1",
    );

    await service.rescheduleSession("session-1", {
      startsAt: new Date("2026-09-03T10:00:00.000Z"),
      endsAt: new Date("2026-09-03T11:00:00.000Z"),
    });

    const notifications = await service.listNotifications("guardian-1");
    const audits = await service.listAuditLogs();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "SESSION_RESCHEDULED",
      sessionId: "session-1",
      readAt: null,
    });
    expect(audits[0]).toMatchObject({
      actorId: "admin-1",
      action: "SESSION_RESCHEDULED",
      entityId: "session-1",
    });
  });
});

describe("SchedulingService.cancelSession", () => {
  it("停课时批量标记有效预约并通知家长", async () => {
    const repository = new MemoryRepository({
      users: [
        { id: "guardian-1", organizationId: "org-development", role: "GUARDIAN" },
      ],
      guardians: [
        {
          organizationId: "org-development",
          guardianId: "guardian-1",
          studentId: "student-1",
        },
      ],
      students,
      sessions: [makeSession()],
      bookings: [
        {
          id: "booking-1",
          sessionId: "session-1",
          studentId: "student-1",
          status: "CONFIRMED",
          createdAt: NOW,
        },
        {
          id: "booking-2",
          sessionId: "session-1",
          studentId: "student-2",
          status: "CANCELLED",
          createdAt: NOW,
        },
      ],
    });
    const service = new SchedulingService(repository, () => NOW);

    const cancelled = await service.cancelSession("session-1", "老师请假");

    expect(cancelled.status).toBe("CANCELLED");
    expect(await repository.getBooking("org-development", "booking-1")).toMatchObject({
      status: "COURSE_CANCELLED",
    });
    expect(await repository.getBooking("org-development", "booking-2")).toMatchObject({
      status: "CANCELLED",
    });
    expect(await service.listNotifications("guardian-1")).toHaveLength(1);
    expect((await service.listAuditLogs())[0]).toMatchObject({
      action: "SESSION_CANCELLED",
    });
  });
});

describe("SchedulingService.markAttendance", () => {
  it.each(["ATTENDED", "LEAVE", "ABSENT"] as const)("支持签到状态 %s", async (status) => {
    const booking: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const { service } = createService({ bookings: [booking] });

    const result = await service.markAttendance("session-1", [
      { bookingId: "booking-1", status },
    ]);

    expect(result[0]?.status).toBe(status);
    expect((await service.listAuditLogs())[0]).toMatchObject({
      action: "ATTENDANCE_UPDATED",
    });
  });

  it("拒绝为已取消预约签到", async () => {
    const { service } = createService({
      bookings: [
        {
          id: "booking-1",
          sessionId: "session-1",
          studentId: "student-1",
          status: "CANCELLED",
          createdAt: NOW,
        },
      ],
    });

    await expect(
      service.markAttendance("session-1", [
        { bookingId: "booking-1", status: "ATTENDED" },
      ]),
    ).rejects.toMatchObject({ code: "BOOKING_NOT_ATTENDABLE" });
  });
});

describe("SchedulingService notifications", () => {
  it("仅允许接收人读取通知，并支持未读筛选", async () => {
    const repository = new MemoryRepository({
      notifications: [
        {
          id: "notice-1",
          organizationId: "org-development",
          userId: "guardian-1",
          type: "SESSION_CANCELLED",
          title: "停课",
          content: "课程已停课",
          sessionId: "session-1",
          readAt: null,
          createdAt: NOW,
        },
      ],
    });
    const service = new SchedulingService(repository, () => NOW);

    await expect(
      service.markNotificationRead("notice-1", "guardian-2"),
    ).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
    const read = await service.markNotificationRead("notice-1", "guardian-1");

    expect(read.readAt).toEqual(NOW);
    await expect(service.listNotifications("guardian-1", true)).resolves.toEqual([]);
  });
});
