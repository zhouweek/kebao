import { describe, expect, it, vi } from "vitest";
import type {
  CoursePurchase,
  CreditReservation,
  StudentCourseEntitlement,
} from "../src/course-packages.js";
import {
  SchedulingService,
  type AuditLog,
  type Booking,
  type CourseSession,
} from "../src/domain.js";
import { MemoryRepository, type MemorySeed } from "../src/memory-repository.js";
import { PrismaRepository } from "../src/prisma-repository.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const ENDED_AT = new Date("2026-09-10T03:00:00.000Z");

function session(): CourseSession {
  return {
    id: "session-1",
    courseId: "course-1",
    courseName: "编程课",
    campusId: "campus-1",
    campusName: "中心校区",
    classroomId: null,
    classroomName: null,
    teacherId: "teacher-1",
    teacherName: "王老师",
    startsAt: new Date("2026-09-10T02:00:00.000Z"),
    endsAt: ENDED_AT,
    capacity: 20,
    status: "PUBLISHED",
    bookingOpensAt: new Date("2026-08-01T00:00:00.000Z"),
    bookingClosesAt: new Date("2026-09-09T00:00:00.000Z"),
    cancelDeadlineAt: new Date("2026-09-08T00:00:00.000Z"),
  };
}

function purchase(id: string, studentId: string): CoursePurchase {
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
    absentDeductsCreditSnapshot: false,
    lateCancellationDeductsCreditSnapshot: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function entitlement(
  id: string,
  purchaseId: string,
  studentId: string,
  validUntil = "2026-12-31T00:00:00.000Z",
): StudentCourseEntitlement {
  return {
    id,
    purchaseId,
    packageId: "package-1",
    courseId: "course-1",
    studentId,
    totalCredits: 10,
    remainingCredits: 10,
    reservedCredits: 0,
    version: 0,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: new Date(validUntil),
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function repository(seed: MemorySeed = {}) {
  return new MemoryRepository({
    organizations: ["org-a"],
    users: [{ id: "admin-1", organizationId: "org-a", role: "ADMIN" }],
    students: [
      { id: "student-1", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
      { id: "student-2", organizationId: "org-a", name: "学生乙", guardianPhone: "" },
      { id: "student-3", organizationId: "org-a", name: "学生丙", guardianPhone: "" },
    ],
    sessions: [{ ...session(), organizationId: "org-a" }],
    ...seed,
  });
}

function service(repo: MemoryRepository, now: () => Date = () => NOW) {
  let sequence = 0;
  return new SchedulingService(
    repo,
    now,
    () => `regression-${String(++sequence).padStart(3, "0")}`,
    "org-a",
    "admin-1",
  );
}

describe("管理员取消状态约束", () => {
  it.each(
    (["ATTENDED", "LEAVE", "ABSENT"] as const).flatMap((status) => [
      { status, current: NOW, phase: "课次结束前" },
      { status, current: new Date("2026-09-10T04:00:00.000Z"), phase: "课次结束后" },
    ]),
  )("$phase取消$status预约返回409", async ({ status, current }) => {
    const booking: Booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: NOW,
    };
    const repo = repository({ bookings: [{ ...booking, organizationId: "org-a" }] });
    let clock = NOW;
    const scheduling = service(repo, () => clock);
    await scheduling.markAttendance("session-1", [{ bookingId: booking.id, status }]);
    clock = current;

    await expect(
      scheduling.cancelBookingForAdmin(booking.id, "状态已结算"),
    ).rejects.toMatchObject({
      code: "BOOKING_NOT_CANCELLABLE",
      statusCode: 409,
    });
    await expect(repo.getBooking("org-a", booking.id)).resolves.toMatchObject({ status });
  });
});

describe("取消后重约权益关联", () => {
  it.each([
    {
      name: "已过期",
      mutate: (item: StudentCourseEntitlement) => ({
        ...item,
        validUntil: new Date("2026-09-09T00:00:00.000Z"),
      }),
    },
    {
      name: "非ACTIVE",
      mutate: (item: StudentCourseEntitlement) => ({
        ...item,
        status: "EXPIRED" as const,
      }),
    },
    {
      name: "余额不足",
      mutate: (item: StudentCourseEntitlement) => ({
        ...item,
        remainingCredits: item.reservedCredits,
        status: "EXHAUSTED" as const,
      }),
    },
  ])("原权益$name时不自动切换", async ({ mutate }) => {
    const repo = repository({
      coursePackages: [{
        id: "package-1",
        organizationId: "org-a",
        version: 0,
        courseId: "course-1",
        name: "编程课包",
        description: null,
        creditCount: 10,
        validityMonths: 12,
        priceCents: 1000,
        absentDeductsCredit: false,
        lateCancellationDeductsCredit: false,
        status: "ACTIVE",
        createdAt: NOW,
        updatedAt: NOW,
      }],
      coursePurchases: [
        { ...purchase("purchase-old", "student-1"), organizationId: "org-a" },
        { ...purchase("purchase-new", "student-1"), organizationId: "org-a" },
      ],
      studentEntitlements: [
        {
          ...entitlement("entitlement-old", "purchase-old", "student-1", "2026-09-30T00:00:00.000Z"),
          organizationId: "org-a",
        },
        {
          ...entitlement("entitlement-new", "purchase-new", "student-1"),
          organizationId: "org-a",
        },
      ],
    });
    const scheduling = service(repo);
    const first = await scheduling.bookForAdmin("session-1", "student-1");
    await scheduling.cancelBookingForAdmin(first.booking.id, "调整计划");
    const oldEntitlement = await repo.getStudentEntitlement("org-a", "entitlement-old");
    await repo.saveStudentEntitlement(
      "org-a",
      {
        ...mutate(oldEntitlement!),
        version: oldEntitlement!.version + 1,
        updatedAt: new Date("2026-09-02T00:00:00.000Z"),
      },
      oldEntitlement!.version,
    );

    await expect(
      scheduling.bookForAdmin("session-1", "student-1"),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_COURSE_CREDITS",
      statusCode: 409,
    });
    await expect(repo.getBooking("org-a", first.booking.id)).resolves.toMatchObject({
      entitlementId: "entitlement-old",
      status: "CANCELLED",
    });
    await expect(
      repo.getCreditReservationByBooking("org-a", first.booking.id),
    ).resolves.toMatchObject({
      entitlementId: "entitlement-old",
      status: "RELEASED",
    });
    await expect(repo.getStudentEntitlement("org-a", "entitlement-new")).resolves.toMatchObject({
      reservedCredits: 0,
    });
  });
});

describe("过期预占结算", () => {
  it("失败项指数退避且不阻塞后续项，并在退避到期后重试成功", async () => {
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
    const repo = new CandidateFailingRepository({
      organizations: ["org-a"],
      users: [{ id: "admin-1", organizationId: "org-a", role: "ADMIN" }],
      students: [
        { id: "student-1", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
        { id: "student-2", organizationId: "org-a", name: "学生乙", guardianPhone: "" },
      ],
      sessions: [{ ...session(), organizationId: "org-a" }],
      coursePackages: [{
        id: "package-1",
        organizationId: "org-a",
        version: 0,
        courseId: "course-1",
        name: "编程课包",
        description: null,
        creditCount: 10,
        validityMonths: 12,
        priceCents: 1000,
        absentDeductsCredit: false,
        lateCancellationDeductsCredit: false,
        status: "ACTIVE",
        createdAt: NOW,
        updatedAt: NOW,
      }],
      coursePurchases: [
        { ...purchase("purchase-1", "student-1"), organizationId: "org-a" },
        { ...purchase("purchase-2", "student-2"), organizationId: "org-a" },
      ],
      studentEntitlements: [
        { ...entitlement("entitlement-1", "purchase-1", "student-1"), organizationId: "org-a" },
        { ...entitlement("entitlement-2", "purchase-2", "student-2"), organizationId: "org-a" },
      ],
    });
    let clock = NOW;
    const scheduling = service(repo, () => clock);
    const failed = await scheduling.bookForAdmin("session-1", "student-1");
    const succeeded = await scheduling.bookForAdmin("session-1", "student-2");
    repo.failingBookingId = failed.booking.id;
    clock = new Date("2026-09-10T04:00:00.000Z");

    await expect(scheduling.settleExpiredReservations(1)).resolves.toBe(0);
    await expect(repo.getBooking("org-a", failed.booking.id)).resolves.toMatchObject({
      status: "CONFIRMED",
    });
    await expect(repo.getBooking("org-a", succeeded.booking.id)).resolves.toMatchObject({
      status: "CONFIRMED",
    });
    await expect(
      repo.getCreditReservationByBooking("org-a", failed.booking.id),
    ).resolves.toMatchObject({
      settlementAttemptCount: 1,
      settlementLastError: "candidate audit unavailable",
      nextSettlementAttemptAt: new Date("2026-09-10T04:02:00.000Z"),
    });

    await expect(scheduling.settleExpiredReservations(2)).resolves.toBe(1);
    await expect(repo.getBooking("org-a", succeeded.booking.id)).resolves.toMatchObject({
      status: "ABSENT",
    });

    clock = new Date("2026-09-10T04:01:59.999Z");
    await expect(scheduling.settleExpiredReservations(2)).resolves.toBe(0);
    await expect(repo.getBooking("org-a", failed.booking.id)).resolves.toMatchObject({
      status: "CONFIRMED",
    });

    clock = new Date("2026-09-10T04:02:00.000Z");
    await expect(scheduling.settleExpiredReservations(2)).resolves.toBe(0);
    await expect(
      repo.getCreditReservationByBooking("org-a", failed.booking.id),
    ).resolves.toMatchObject({
      settlementAttemptCount: 2,
      settlementLastError: "candidate audit unavailable",
      nextSettlementAttemptAt: new Date("2026-09-10T04:06:00.000Z"),
    });

    repo.failingBookingId = undefined;
    clock = new Date("2026-09-10T04:05:59.999Z");
    await expect(scheduling.settleExpiredReservations(2)).resolves.toBe(0);
    clock = new Date("2026-09-10T04:06:00.000Z");
    await expect(scheduling.settleExpiredReservations(2)).resolves.toBe(1);
    await expect(repo.getBooking("org-a", failed.booking.id)).resolves.toMatchObject({
      status: "ABSENT",
    });
    await expect(
      repo.getCreditReservationByBooking("org-a", failed.booking.id),
    ).resolves.toMatchObject({
      settlementAttemptCount: 2,
      settlementLastError: null,
      nextSettlementAttemptAt: null,
    });
  });
});

describe("listExpiredCreditReservations 排除ID", () => {
  const expiredAt = new Date("2026-09-10T04:00:00.000Z");

  it("Memory 仓储跳过已排除reservation", async () => {
    const reservations: Array<CreditReservation & { organizationId: string }> = [
      {
        id: "reservation-1",
        organizationId: "org-a",
        entitlementId: "entitlement-1",
        bookingId: "booking-1",
        credits: 1,
        status: "RESERVED",
        expiresAt: ENDED_AT,
        releasedAt: null,
        consumedAt: null,
        settlementAttemptCount: 0,
        nextSettlementAttemptAt: null,
        settlementLastError: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "reservation-2",
        organizationId: "org-a",
        entitlementId: "entitlement-2",
        bookingId: "booking-2",
        credits: 1,
        status: "RESERVED",
        expiresAt: ENDED_AT,
        releasedAt: null,
        consumedAt: null,
        settlementAttemptCount: 0,
        nextSettlementAttemptAt: null,
        settlementLastError: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const repo = repository({
      bookings: reservations.map((item, index) => ({
        id: item.bookingId,
        organizationId: "org-a",
        sessionId: "session-1",
        studentId: `student-${index + 1}`,
        status: "CONFIRMED" as const,
        createdAt: NOW,
      })),
      creditReservations: reservations,
    });
    const list = repo.listExpiredCreditReservations.bind(repo) as (
      organizationId: string,
      expiresAt: Date,
      limit: number,
      excludedIds?: readonly string[],
    ) => Promise<CreditReservation[]>;

    await expect(list("org-a", expiredAt, 1, ["reservation-1"])).resolves.toMatchObject([
      { id: "reservation-2" },
    ]);
  });

  it("Prisma 仓储将排除ID下推到查询条件", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { creditReservation: { findMany } };
    const repo = new PrismaRepository(prisma as never);
    const list = repo.listExpiredCreditReservations.bind(repo) as (
      organizationId: string,
      expiresAt: Date,
      limit: number,
      excludedIds?: readonly string[],
    ) => Promise<CreditReservation[]>;

    await list("org-a", expiredAt, 5, ["reservation-1", "reservation-2"]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ["reservation-1", "reservation-2"] },
          OR: [
            { nextSettlementAttemptAt: null },
            { nextSettlementAttemptAt: { lte: expiredAt } },
          ],
        }),
        take: 5,
      }),
    );
  });
});

describe("reservation 权益关联不可变", () => {
  it("Memory 仓储更新状态时保留原 entitlementId", async () => {
    const original: CreditReservation & { organizationId: string } = {
      id: "reservation-immutable",
      organizationId: "org-a",
      entitlementId: "entitlement-old",
      bookingId: "booking-immutable",
      credits: 1,
      status: "RELEASED",
      expiresAt: ENDED_AT,
      releasedAt: NOW,
      consumedAt: null,
      settlementAttemptCount: 0,
      nextSettlementAttemptAt: null,
      settlementLastError: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const repo = repository({ creditReservations: [original] });

    await repo.saveCreditReservation("org-a", {
      ...original,
      entitlementId: "entitlement-new",
      status: "RESERVED",
    });

    await expect(
      repo.getCreditReservationByBooking("org-a", original.bookingId),
    ).resolves.toMatchObject({
      entitlementId: "entitlement-old",
      status: "RESERVED",
    });
  });
});

describe("预约排序", () => {
  const bookings = ["booking-a", "booking-z"].map((id, index) => ({
    id,
    organizationId: "org-a",
    sessionId: "session-1",
    studentId: `student-${index + 1}`,
    status: "CONFIRMED" as const,
    createdAt: NOW,
  }));

  it("Memory 按 createdAt desc、id desc 稳定排序", async () => {
    const repo = repository({ bookings });

    await expect(repo.listBookings("org-a")).resolves.toMatchObject([
      { id: "booking-z" },
      { id: "booking-a" },
    ]);
    await expect(
      repo.listAdminBookings("org-a", { page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: "booking-z" }, { id: "booking-a" }],
    });
  });

  it("Prisma 对普通与后台预约查询使用相同稳定排序", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { booking: { findMany, count: vi.fn().mockResolvedValue(0) } };
    const repo = new PrismaRepository(prisma as never);

    await repo.listBookings("org-a");
    expect(findMany).toHaveBeenLastCalledWith({
      where: { organizationId: "org-a" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    await repo.listAdminBookings("org-a", { page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });
});
