import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type {
  CoursePackage,
  CoursePurchase,
  StudentCourseEntitlement,
} from "../src/course-packages.js";
import {
  SchedulingService,
  type AuditLog,
  type CourseSession,
} from "../src/domain.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { NotificationWorker } from "../src/notification-worker.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const apps: ReturnType<typeof buildApp>[] = [];

function session(id: string): CourseSession {
  const startsAt =
    id === "session-2"
      ? new Date("2026-09-11T02:00:00.000Z")
      : new Date("2026-09-10T02:00:00.000Z");
  return {
    id,
    courseId: "course-1",
    courseName: "编程课",
    campusId: "campus-1",
    campusName: "中心校区",
    classroomId: null,
    classroomName: null,
    teacherId: "teacher-1",
    teacherName: "王老师",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
    capacity: 10,
    status: "PUBLISHED",
    bookingOpensAt: new Date("2026-08-01T00:00:00.000Z"),
    bookingClosesAt: new Date("2026-09-09T00:00:00.000Z"),
    cancelDeadlineAt: new Date("2026-09-08T00:00:00.000Z"),
  };
}

function coursePackage(): CoursePackage {
  return {
    id: "package-1",
    version: 0,
    courseId: "course-1",
    name: "编程课包",
    description: null,
    creditCount: 10,
    validityMonths: 12,
    priceCents: 1000,
    absentDeductsCredit: true,
    lateCancellationDeductsCredit: false,
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function purchase(
  id: string,
  studentId: string,
  absentDeductsCreditSnapshot: boolean,
  lateCancellationDeductsCreditSnapshot = false,
): CoursePurchase {
  return {
    id,
    packageId: "package-1",
    packageNameSnapshot: "编程课包",
    courseId: "course-1",
    courseNameSnapshot: "编程课",
    studentId,
    creditCount: 10,
    validityMonths: 12,
    paidAmountCents: 1000,
    status: "PAID",
    purchasedAt: NOW,
    note: null,
    createdBy: "admin-1",
    idempotencyKey: `purchase-${id}`,
    requestFingerprint: `fingerprint-${id}`,
    absentDeductsCreditSnapshot,
    lateCancellationDeductsCreditSnapshot,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function entitlement(
  id: string,
  purchaseId: string,
  studentId: string,
  validUntil: string,
  remainingCredits = 10,
): StudentCourseEntitlement {
  return {
    id,
    purchaseId,
    packageId: "package-1",
    courseId: "course-1",
    studentId,
    totalCredits: 10,
    remainingCredits,
    reservedCredits: 0,
    version: 0,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: new Date(validUntil),
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function repository(singleCredit = false, lateCancellationDeductsCredit = false) {
  return new MemoryRepository({
    organizations: ["org-a", "org-b"],
    users: [
      { id: "admin-1", organizationId: "org-a", role: "ADMIN" },
      { id: "admin-2", organizationId: "org-b", role: "ADMIN" },
    ],
    students: [
      { id: "student-1", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
      { id: "student-2", organizationId: "org-a", name: "学生乙", guardianPhone: "" },
    ],
    sessions: [
      { ...session("session-1"), organizationId: "org-a" },
      { ...session("session-2"), organizationId: "org-a" },
    ],
    masterData: {
      courses: [
        {
          id: "course-1",
          organizationId: "org-a",
          name: "编程课",
          durationMinutes: 60,
          isActive: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    },
    coursePackages: [{ ...coursePackage(), organizationId: "org-a" }],
    coursePurchases: [
      {
        ...purchase("purchase-early", "student-1", true, lateCancellationDeductsCredit),
        organizationId: "org-a",
      },
      { ...purchase("purchase-late", "student-1", true), organizationId: "org-a" },
      { ...purchase("purchase-no-absent", "student-2", false), organizationId: "org-a" },
    ],
    studentEntitlements: [
      {
        ...entitlement(
          "entitlement-early",
          "purchase-early",
          "student-1",
          "2026-09-30T00:00:00.000Z",
          1,
        ),
        organizationId: "org-a",
      },
      {
        ...entitlement(
          "entitlement-late",
          "purchase-late",
          "student-1",
          "2026-12-31T00:00:00.000Z",
          singleCredit ? 0 : 10,
        ),
        ...(singleCredit ? { status: "EXHAUSTED" as const } : {}),
        organizationId: "org-a",
      },
      {
        ...entitlement(
          "entitlement-no-absent",
          "purchase-no-absent",
          "student-2",
          "2026-12-31T00:00:00.000Z",
        ),
        organizationId: "org-a",
      },
    ],
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("预约课时权益生命周期", () => {
  it("预约按最早到期权益预占，取消释放，重复操作幂等", async () => {
    const repo = repository(true);
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `id-${++sequence}`,
      "org-a",
      "admin-1",
    );

    const first = await service.bookForAdmin("session-1", "student-1");
    expect(first.booking.entitlementId).toBe("entitlement-early");
    expect(await repo.getStudentEntitlement("org-a", "entitlement-early")).toMatchObject({
      remainingCredits: 1,
      reservedCredits: 1,
    });
    expect((await repo.listCreditLedgers("org-a", "entitlement-early"))[0]).toMatchObject({
      type: "RESERVE",
      bookingId: first.booking.id,
    });

    await service.cancelBookingForAdmin(first.booking.id, "调整计划");
    await service.cancelBookingForAdmin(first.booking.id, "重复取消");
    expect(await repo.getStudentEntitlement("org-a", "entitlement-early")).toMatchObject({
      remainingCredits: 1,
      reservedCredits: 0,
    });
    expect(
      (await repo.listCreditLedgers("org-a", "entitlement-early")).filter(
        (item) => item.type === "RELEASE",
      ),
    ).toHaveLength(1);

    const rebooked = await service.bookForAdmin("session-1", "student-1");
    expect(rebooked).toMatchObject({ alreadyBooked: false, booking: { id: first.booking.id } });
    expect(await repo.getStudentEntitlement("org-a", "entitlement-early")).toMatchObject({
      remainingCredits: 1,
      reservedCredits: 1,
    });
    expect(
      (await repo.listCreditLedgers("org-a", "entitlement-early")).filter(
        (item) => item.type === "REVERSAL",
      ),
    ).toHaveLength(1);
  });

  it.each([
    {
      name: "不覆盖课次上海业务日期",
      mutate: (item: StudentCourseEntitlement) => ({
        ...item,
        validUntil: new Date("2026-09-09T00:00:00.000Z"),
      }),
    },
    {
      name: "状态不再为 ACTIVE",
      mutate: (item: StudentCourseEntitlement) => ({
        ...item,
        status: "EXPIRED" as const,
      }),
    },
    {
      name: "没有可预占余额",
      mutate: (item: StudentCourseEntitlement) => ({
        ...item,
        remainingCredits: item.reservedCredits,
        status: "EXHAUSTED" as const,
      }),
    },
  ])("取消后重新预约时旧权益$name则拒绝重约且保留原权益关联", async ({ mutate }) => {
    const repo = repository();
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `rebook-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const first = await service.bookForAdmin("session-1", "student-1");
    await service.cancelBookingForAdmin(first.booking.id, "调整计划");
    const oldEntitlement = await repo.getStudentEntitlement("org-a", "entitlement-early");
    expect(oldEntitlement).toBeDefined();
    const invalidated = {
      ...mutate(oldEntitlement!),
      version: oldEntitlement!.version + 1,
      updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    };
    await expect(
      repo.saveStudentEntitlement(
        "org-a",
        invalidated,
        oldEntitlement!.version,
      ),
    ).resolves.toBe(true);

    await expect(
      service.bookForAdmin("session-1", "student-1"),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_COURSE_CREDITS",
      statusCode: 409,
    });
    await expect(repo.getBooking("org-a", first.booking.id)).resolves.toMatchObject({
      entitlementId: "entitlement-early",
      status: "CANCELLED",
    });
    await expect(
      repo.getCreditReservationByBooking("org-a", first.booking.id),
    ).resolves.toMatchObject({
      entitlementId: "entitlement-early",
      status: "RELEASED",
    });
    await expect(
      repo.getStudentEntitlement("org-a", "entitlement-late"),
    ).resolves.toMatchObject({ reservedCredits: 0 });
    await expect(
      repo.listBookingCreditLedgers("org-a", first.booking.id),
    ).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entitlementId: "entitlement-late",
        }),
      ]),
    );
  });

  it("ATTENDED 核销，纠正为 LEAVE 时以 REVERSAL 冲正后释放", async () => {
    const repo = repository();
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `attendance-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const { booking } = await service.bookForAdmin("session-1", "student-1");

    await service.markAttendance("session-1", [
      { bookingId: booking.id, status: "ATTENDED" },
    ]);
    expect(await repo.getStudentEntitlement("org-a", "entitlement-early")).toMatchObject({
      remainingCredits: 0,
      reservedCredits: 0,
      status: "EXHAUSTED",
    });

    await service.markAttendance("session-1", [
      { bookingId: booking.id, status: "LEAVE" },
    ]);
    await service.markAttendance("session-1", [
      { bookingId: booking.id, status: "LEAVE" },
    ]);
    expect(await repo.getStudentEntitlement("org-a", "entitlement-early")).toMatchObject({
      remainingCredits: 1,
      reservedCredits: 0,
      status: "ACTIVE",
    });
    const ledgers = await repo.listCreditLedgers("org-a", "entitlement-early");
    expect(ledgers.map((item) => item.type).sort()).toEqual(
      ["CONSUME", "RELEASE", "RESERVE", "REVERSAL"].sort(),
    );
    const reversal = ledgers.find((item) => item.type === "REVERSAL");
    const consumed = ledgers.find((item) => item.type === "CONSUME");
    expect(reversal?.reversalOfId).toBe(consumed?.id);
  });

  it("从 RELEASE 纠正为 CONSUME 时余额不足返回明确 409 且事务不变", async () => {
    const repo = repository(true);
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `release-to-consume-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const { booking } = await service.bookForAdmin("session-1", "student-1");
    await service.markAttendance("session-1", [
      { bookingId: booking.id, status: "LEAVE" },
    ]);
    const releasedEntitlement = await repo.getStudentEntitlement(
      "org-a",
      "entitlement-early",
    );
    await repo.saveStudentEntitlement(
      "org-a",
      {
        ...releasedEntitlement!,
        remainingCredits: 0,
        status: "EXHAUSTED",
        version: releasedEntitlement!.version + 1,
        updatedAt: new Date(NOW.getTime() + 1),
      },
      releasedEntitlement!.version,
    );
    const before = {
      booking: await repo.getBooking("org-a", booking.id),
      reservation: await repo.getCreditReservationByBooking("org-a", booking.id),
      entitlement: await repo.getStudentEntitlement("org-a", "entitlement-early"),
      ledgers: await repo.listCreditLedgers("org-a", "entitlement-early"),
      audits: await repo.listAuditLogs("org-a"),
    };

    await expect(
      service.markAttendance("session-1", [
        { bookingId: booking.id, status: "ATTENDED" },
      ]),
    ).rejects.toMatchObject({
      code: "RESERVATION_RESTORE_INSUFFICIENT_CREDITS",
      message: "当前权益可用余额不足，无法恢复原预约预占",
      statusCode: 409,
    });

    await expect(repo.getBooking("org-a", booking.id)).resolves.toEqual(before.booking);
    await expect(
      repo.getCreditReservationByBooking("org-a", booking.id),
    ).resolves.toEqual(before.reservation);
    await expect(
      repo.getStudentEntitlement("org-a", "entitlement-early"),
    ).resolves.toEqual(before.entitlement);
    await expect(
      repo.listCreditLedgers("org-a", "entitlement-early"),
    ).resolves.toEqual(before.ledgers);
    await expect(repo.listAuditLogs("org-a")).resolves.toEqual(before.audits);
  });

  it("ABSENT 严格按购买快照决定核销或释放", async () => {
    const repo = repository();
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `absent-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const deduct = await service.bookForAdmin("session-1", "student-1");
    const release = await service.bookForAdmin("session-1", "student-2");
    await service.markAttendance("session-1", [
      { bookingId: deduct.booking.id, status: "ABSENT" },
      { bookingId: release.booking.id, status: "ABSENT" },
    ]);

    expect(await repo.getStudentEntitlement("org-a", "entitlement-early")).toMatchObject({
      remainingCredits: 0,
      reservedCredits: 0,
    });
    expect(await repo.getStudentEntitlement("org-a", "entitlement-no-absent")).toMatchObject({
      remainingCredits: 10,
      reservedCredits: 0,
    });
  });

  it("并发预约同一份最后课时仅允许一个成功", async () => {
    const repo = repository(true);
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `concurrent-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const results = await Promise.allSettled([
      service.bookForAdmin("session-1", "student-1"),
      service.bookForAdmin("session-2", "student-1"),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected")).toMatchObject({
      reason: { code: "INSUFFICIENT_COURSE_CREDITS" },
    });
  });

  it("任一审计写入失败会回滚预约、权益、reservation 和 ledger", async () => {
    class FailingAuditRepository extends MemoryRepository {
      override async saveAuditLog(organizationId: string, auditLog: AuditLog) {
        if (auditLog.action === "ADMIN_BOOKING_CREATED") throw new Error("audit failed");
        return super.saveAuditLog(organizationId, auditLog);
      }
    }
    const source = repository();
    const repo = new FailingAuditRepository({
      organizations: ["org-a"],
      users: [{ id: "admin-1", organizationId: "org-a", role: "ADMIN" }],
      students: [
        { id: "student-1", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
      ],
      sessions: [{ ...session("session-1"), organizationId: "org-a" }],
      masterData: {
        courses: [
          {
            ...(await source.getMasterData("org-a", "courses", "course-1"))!,
            organizationId: "org-a",
          },
        ],
      },
      coursePackages: [{ ...coursePackage(), organizationId: "org-a" }],
      coursePurchases: [
        { ...purchase("purchase-early", "student-1", true), organizationId: "org-a" },
      ],
      studentEntitlements: [
        {
          ...entitlement(
            "entitlement-early",
            "purchase-early",
            "student-1",
            "2026-09-30T00:00:00.000Z",
            1,
          ),
          organizationId: "org-a",
        },
      ],
    });
    const service = new SchedulingService(repo, () => NOW, () => crypto.randomUUID(), "org-a", "admin-1");

    await expect(service.bookForAdmin("session-1", "student-1")).rejects.toThrow("audit failed");
    await expect(repo.listBookings("org-a")).resolves.toEqual([]);
    await expect(repo.getStudentEntitlement("org-a", "entitlement-early")).resolves.toMatchObject({
      remainingCredits: 1,
      reservedCredits: 0,
      version: 0,
    });
    await expect(repo.listCreditLedgers("org-a", "entitlement-early")).resolves.toEqual([]);
  });

  it("管理员晚取消按购买快照核销，提前取消和不扣费快照仍释放", async () => {
    const lateDeductRepo = repository(false, true);
    let current = NOW;
    let sequence = 0;
    const lateDeductService = new SchedulingService(
      lateDeductRepo,
      () => current,
      () => `late-deduct-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const lateDeductBooking = await lateDeductService.bookForAdmin("session-1", "student-1");
    current = new Date("2026-09-09T00:00:00.000Z");
    await lateDeductService.cancelBookingForAdmin(lateDeductBooking.booking.id, "临时有事");
    expect(
      await lateDeductRepo.getStudentEntitlement("org-a", "entitlement-early"),
    ).toMatchObject({
      remainingCredits: 0,
      reservedCredits: 0,
      version: 2,
    });
    expect(
      await lateDeductRepo.listBookingCreditLedgers("org-a", lateDeductBooking.booking.id),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "CONSUME", note: "管理员晚取消：临时有事" }),
      ]),
    );

    const releaseRepo = repository();
    current = NOW;
    const releaseService = new SchedulingService(
      releaseRepo,
      () => current,
      () => `release-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const early = await releaseService.bookForAdmin("session-1", "student-1");
    await releaseService.cancelBooking(early.booking.id);
    const lateNoDeduct = await releaseService.bookForAdmin("session-1", "student-2");
    current = new Date("2026-09-09T00:00:00.000Z");
    await releaseService.cancelBookingForAdmin(lateNoDeduct.booking.id, "临时调整");
    expect(
      (await releaseRepo.listBookingCreditLedgers("org-a", early.booking.id)).filter(
        (item) => item.type === "RELEASE",
      ),
    ).toHaveLength(1);
    expect(
      (await releaseRepo.listBookingCreditLedgers("org-a", lateNoDeduct.booking.id)).filter(
        (item) => item.type === "RELEASE",
      ),
    ).toHaveLength(1);
  });

  it("周期 worker 对课次结束后仍 RESERVED 的未签到预约按缺席快照原子结算", async () => {
    const repo = repository();
    let current = NOW;
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => current,
      () => `timeout-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const deduct = await service.bookForAdmin("session-1", "student-1");
    const release = await service.bookForAdmin("session-1", "student-2");
    current = new Date("2026-09-10T04:00:00.000Z");
    const worker = new NotificationWorker(repo, undefined, { templateIds: {} }, () => current);

    const results = await Promise.all([
      worker.settleExpiredReservations(),
      worker.settleExpiredReservations(),
    ]);

    expect(results.reduce((sum, item) => sum + item, 0)).toBe(2);
    expect(await repo.getBooking("org-a", deduct.booking.id)).toMatchObject({ status: "ABSENT" });
    expect(await repo.getBooking("org-a", release.booking.id)).toMatchObject({ status: "ABSENT" });
    expect(await repo.getStudentEntitlement("org-a", "entitlement-early")).toMatchObject({
      remainingCredits: 0,
      reservedCredits: 0,
      version: 2,
    });
    expect(await repo.getStudentEntitlement("org-a", "entitlement-no-absent")).toMatchObject({
      remainingCredits: 10,
      reservedCredits: 0,
      version: 2,
    });
    expect(
      (await repo.listBookingCreditLedgers("org-a", deduct.booking.id)).filter(
        (item) => item.type === "CONSUME",
      ),
    ).toHaveLength(1);
    expect(
      (await repo.listBookingCreditLedgers("org-a", release.booking.id)).filter(
        (item) => item.type === "RELEASE",
      ),
    ).toHaveLength(1);
  });

  it("过期预占按 candidate 隔离异常，继续结算本机构后续项并记录失败审计", async () => {
    class CandidateFailingRepository extends MemoryRepository {
      failingBookingId: string | undefined;

      override async saveAuditLog(organizationId: string, auditLog: AuditLog) {
        if (
          auditLog.action === "BOOKING_AUTO_SETTLED_ABSENT" &&
          auditLog.entityId === this.failingBookingId
        ) {
          throw new Error("candidate audit unavailable");
        }
        return super.saveAuditLog(organizationId, auditLog);
      }
    }
    const source = repository();
    const repo = new CandidateFailingRepository({
      organizations: ["org-a"],
      users: [{ id: "admin-1", organizationId: "org-a", role: "ADMIN" }],
      students: [
        { id: "student-1", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
        { id: "student-2", organizationId: "org-a", name: "学生乙", guardianPhone: "" },
      ],
      sessions: [{ ...session("session-1"), organizationId: "org-a" }],
      masterData: {
        courses: [
          {
            ...(await source.getMasterData("org-a", "courses", "course-1"))!,
            organizationId: "org-a",
          },
        ],
      },
      coursePackages: [{ ...coursePackage(), organizationId: "org-a" }],
      coursePurchases: [
        { ...purchase("purchase-early", "student-1", true), organizationId: "org-a" },
        {
          ...purchase("purchase-no-absent", "student-2", false),
          organizationId: "org-a",
        },
      ],
      studentEntitlements: [
        {
          ...entitlement(
            "entitlement-early",
            "purchase-early",
            "student-1",
            "2026-09-30T00:00:00.000Z",
          ),
          organizationId: "org-a",
        },
        {
          ...entitlement(
            "entitlement-no-absent",
            "purchase-no-absent",
            "student-2",
            "2026-12-31T00:00:00.000Z",
          ),
          organizationId: "org-a",
        },
      ],
    });
    let current = NOW;
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => current,
      () => `candidate-${String(++sequence).padStart(3, "0")}`,
      "org-a",
      "admin-1",
    );
    const failed = await service.bookForAdmin("session-1", "student-1");
    const succeeded = await service.bookForAdmin("session-1", "student-2");
    repo.failingBookingId = failed.booking.id;
    current = new Date("2026-09-10T04:00:00.000Z");

    await expect(service.settleExpiredReservations(2)).resolves.toBe(1);
    await expect(repo.getBooking("org-a", failed.booking.id)).resolves.toMatchObject({
      status: "CONFIRMED",
    });
    await expect(repo.getBooking("org-a", succeeded.booking.id)).resolves.toMatchObject({
      status: "ABSENT",
    });
    expect(await repo.listAuditLogs("org-a")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_AUTO_SETTLEMENT_FAILED",
          entityId: failed.booking.id,
          details: expect.objectContaining({
            reservationId: expect.any(String),
            sessionId: "session-1",
            error: expect.objectContaining({ message: "candidate audit unavailable" }),
          }),
        }),
      ]),
    );
  });

  it.each(["ATTENDED", "ABSENT"] as const)(
    "课次结束后管理员取消 %s 预约返回 BOOKING_NOT_CANCELLABLE",
    async (status) => {
      const repo = repository();
      let current = NOW;
      let sequence = 0;
      const service = new SchedulingService(
        repo,
        () => current,
        () => `ended-${++sequence}`,
        "org-a",
        "admin-1",
      );
      const { booking } = await service.bookForAdmin("session-1", "student-1");
      await service.markAttendance("session-1", [{ bookingId: booking.id, status }]);
      current = new Date("2026-09-10T04:00:00.000Z");

      await expect(
        service.cancelBookingForAdmin(booking.id, "课后误操作"),
      ).rejects.toMatchObject({
        code: "BOOKING_NOT_CANCELLABLE",
        statusCode: 409,
      });
    },
  );

  it("单次与系列调课同步更新 RESERVED 的 expiresAt", async () => {
    const singleRepo = repository();
    let sequence = 0;
    const singleService = new SchedulingService(
      singleRepo,
      () => NOW,
      () => `single-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const singleBooking = await singleService.bookForAdmin("session-1", "student-1");
    const singleEndsAt = new Date("2026-09-12T03:00:00.000Z");
    await singleService.rescheduleSession("session-1", {
      startsAt: new Date("2026-09-12T02:00:00.000Z"),
      endsAt: singleEndsAt,
    });
    await expect(
      singleRepo.getCreditReservationByBooking("org-a", singleBooking.booking.id),
    ).resolves.toMatchObject({ status: "RESERVED", expiresAt: singleEndsAt });

    const seriesRepo = repository();
    await seriesRepo.saveSession("org-a", {
      ...session("session-1"),
      seriesId: "series-1",
      occurrenceIndex: 0,
    });
    await seriesRepo.saveSession("org-a", {
      ...session("session-2"),
      seriesId: "series-1",
      occurrenceIndex: 1,
    });
    const seriesService = new SchedulingService(
      seriesRepo,
      () => NOW,
      () => `series-${++sequence}`,
      "org-a",
      "admin-1",
    );
    const first = await seriesService.bookForAdmin("session-1", "student-1");
    const second = await seriesService.bookForAdmin("session-2", "student-2");
    const firstEndsAt = new Date("2026-09-13T03:00:00.000Z");
    await seriesService.rescheduleWithScope(
      "session-1",
      {
        startsAt: new Date("2026-09-13T02:00:00.000Z"),
        endsAt: firstEndsAt,
      },
      "THIS_AND_FUTURE",
    );

    await expect(
      seriesRepo.getCreditReservationByBooking("org-a", first.booking.id),
    ).resolves.toMatchObject({ status: "RESERVED", expiresAt: firstEndsAt });
    await expect(
      seriesRepo.getCreditReservationByBooking("org-a", second.booking.id),
    ).resolves.toMatchObject({
      status: "RESERVED",
      expiresAt: new Date("2026-09-14T03:00:00.000Z"),
    });
  });
});

describe("权益延期 API", () => {
  const adminHeaders = {
    "x-tenant-id": "org-a",
    "x-role": "ADMIN",
    "x-user-id": "admin-1",
    "content-type": "application/json",
  };

  it("按自然月延期、记录原因和审计，并使用 version CAS 与租户隔离", async () => {
    const repo = repository();
    const app = buildApp(repo, { developmentIdentityEnabled: true, now: () => NOW });
    apps.push(app);
    const headers = {
      "x-tenant-id": "org-a",
      "x-role": "ADMIN",
      "x-user-id": "admin-1",
      "content-type": "application/json",
    };
    const extended = await app.inject({
      method: "POST",
      url: "/admin/student-entitlements/entitlement-early/extensions",
      headers,
      payload: { months: 1, reason: " 学员请假 ", version: 0 },
    });
    expect(extended.statusCode, extended.body).toBe(200);
    expect(extended.json().data).toMatchObject({
      version: 1,
      validUntil: "2026-10-30T00:00:00.000Z",
    });

    const changes = await app.inject({
      method: "GET",
      url: "/admin/student-entitlements/entitlement-early/validity-changes",
      headers,
    });
    expect(changes.statusCode).toBe(200);
    expect(changes.json().data).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(changes.json().data.items).toEqual([
      expect.objectContaining({
        previousValidUntil: "2026-09-30T00:00:00.000Z",
        newValidUntil: "2026-10-30T00:00:00.000Z",
        reason: "学员请假",
        changedBy: "admin-1",
      }),
    ]);

    const stale = await app.inject({
      method: "POST",
      url: "/admin/student-entitlements/entitlement-early/extensions",
      headers,
      payload: { months: 1, reason: "再次延期", version: 0 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("ENTITLEMENT_CONFLICT");

    const foreign = await app.inject({
      method: "GET",
      url: "/admin/student-entitlements/entitlement-early/validity-changes",
      headers: {
        ...headers,
        "x-tenant-id": "org-b",
        "x-user-id": "admin-2",
      },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("已过期多年的权益只延期一个月后仍保持 EXPIRED", async () => {
    const repo = repository();
    const current = await repo.getStudentEntitlement("org-a", "entitlement-early");
    expect(current).toBeDefined();
    await expect(
      repo.saveStudentEntitlement(
        "org-a",
        {
          ...current!,
          validUntil: new Date("2020-01-31T00:00:00.000Z"),
          status: "EXPIRED",
          version: 1,
        },
        0,
      ),
    ).resolves.toBe(true);
    const app = buildApp(repo, { developmentIdentityEnabled: true, now: () => NOW });
    apps.push(app);

    const extended = await app.inject({
      method: "POST",
      url: "/admin/student-entitlements/entitlement-early/extensions",
      headers: adminHeaders,
      payload: { months: 1, reason: "历史权益补偿", version: 1 },
    });

    expect(extended.statusCode, extended.body).toBe(200);
    expect(extended.json().data).toMatchObject({
      validUntil: "2020-02-29T00:00:00.000Z",
      status: "EXPIRED",
      version: 2,
    });
  });

  it("延期后的有效期跨过上海业务日期时恢复为 ACTIVE", async () => {
    const repo = repository();
    const current = await repo.getStudentEntitlement("org-a", "entitlement-early");
    expect(current).toBeDefined();
    await expect(
      repo.saveStudentEntitlement(
        "org-a",
        {
          ...current!,
          validUntil: new Date("2026-08-31T00:00:00.000Z"),
          status: "EXPIRED",
          version: 1,
        },
        0,
      ),
    ).resolves.toBe(true);
    const app = buildApp(repo, { developmentIdentityEnabled: true, now: () => NOW });
    apps.push(app);

    const extended = await app.inject({
      method: "POST",
      url: "/admin/student-entitlements/entitlement-early/extensions",
      headers: adminHeaders,
      payload: { months: 1, reason: "恢复有效期", version: 1 },
    });

    expect(extended.statusCode, extended.body).toBe(200);
    expect(extended.json().data).toMatchObject({
      validUntil: "2026-09-30T00:00:00.000Z",
      status: "ACTIVE",
      version: 2,
    });
  });
});
