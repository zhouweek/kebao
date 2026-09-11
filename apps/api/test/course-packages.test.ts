import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  addCalendarMonths,
  type CoursePackage,
  CoursePackageService,
  type CoursePurchase,
  type CreditLedger,
  type CreditReservation,
  type EntitlementValidityChange,
  type StudentCourseEntitlement,
  shanghaiBusinessDate,
} from "../src/course-packages.js";
import type { AuditLog } from "../src/domain.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PrismaRepository } from "../src/prisma-repository.js";
import type { Prisma, PrismaClient } from "@prisma/client";

const apps: ReturnType<typeof buildApp>[] = [];
const now = new Date("2026-01-31T15:45:00.000Z");

function headers(
  tenant = "org-a",
  role = "ADMIN",
  user = "admin-a",
): Record<string, string> {
  return {
    "x-tenant-id": tenant,
    "x-role": role,
    "x-user-id": user,
    "content-type": "application/json",
  };
}

function seedRepository() {
  return new MemoryRepository({
    organizations: ["org-a", "org-b"],
    users: [
      { id: "admin-a", organizationId: "org-a", role: "ADMIN" },
      { id: "teacher-a", organizationId: "org-a", role: "TEACHER" },
      { id: "admin-b", organizationId: "org-b", role: "ADMIN" },
    ],
    students: [
      { id: "student-a", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
      { id: "student-a2", organizationId: "org-a", name: "学生乙", guardianPhone: "" },
      { id: "student-b", organizationId: "org-b", name: "外部学生", guardianPhone: "" },
    ],
    masterData: {
      courses: [
        {
          id: "course-a",
          organizationId: "org-a",
          name: "编程课",
          code: "CODE-A",
          durationMinutes: 60,
          description: null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "course-b",
          organizationId: "org-b",
          name: "外部课程",
          code: "CODE-B",
          durationMinutes: 60,
          description: null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  });
}

function createApp(repository = seedRepository(), nowProvider: () => Date = () => now) {
  const app = buildApp(repository, {
    developmentIdentityEnabled: true,
    now: nowProvider,
  });
  apps.push(app);
  return { app, repository };
}

function purchaseRecord(id: string, purchasedAt: Date): CoursePurchase {
  return {
    id,
    packageId: "package-a",
    packageNameSnapshot: "编程月卡",
    courseId: "course-a",
    courseNameSnapshot: "编程课",
    studentId: "student-a",
    creditCount: 4,
    validityMonths: 1,
    paidAmountCents: 120000,
    status: "PAID",
    purchasedAt,
    note: null,
    createdBy: "admin-a",
    idempotencyKey: `key-${id}`,
    requestFingerprint: `fingerprint-${id}`,
    absentDeductsCreditSnapshot: false,
    lateCancellationDeductsCreditSnapshot: false,
    createdAt: purchasedAt,
    updatedAt: purchasedAt,
  };
}

function entitlementRecord(purchaseId: string, createdAt: Date): StudentCourseEntitlement {
  return {
    id: `entitlement-${purchaseId}`,
    purchaseId,
    packageId: "package-a",
    courseId: "course-a",
    studentId: "student-a",
    totalCredits: 4,
    remainingCredits: 4,
    reservedCredits: 0,
    version: 0,
    validFrom: createdAt,
    validUntil: addCalendarMonths(createdAt, 1),
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
  };
}

function packageRecord(id: string, createdAt: Date): CoursePackage {
  return {
    id,
    version: 0,
    courseId: "course-a",
    name: `课包-${id}`,
    description: null,
    creditCount: 4,
    validityMonths: 1,
    priceCents: 120000,
    absentDeductsCredit: false,
    lateCancellationDeductsCredit: false,
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
  };
}

function ledgerRecord(id: string, occurredAt: Date): CreditLedger {
  return {
    id,
    entitlementId: "entitlement-a",
    purchaseId: null,
    reservationId: null,
    bookingId: null,
    idempotencyKey: `ledger-${id}`,
    type: "ADJUSTMENT",
    creditDelta: 0,
    balanceAfter: 4,
    reservedCreditDelta: 0,
    reservedBalanceAfter: 0,
    reversalOfId: null,
    actorId: "admin-a",
    note: null,
    occurredAt,
    createdAt: occurredAt,
  };
}

function validityChangeRecord(id: string, createdAt: Date): EntitlementValidityChange {
  return {
    id,
    entitlementId: "entitlement-a",
    previousValidUntil: new Date("2026-02-01T00:00:00.000Z"),
    newValidUntil: new Date("2026-03-01T00:00:00.000Z"),
    reason: id,
    changedBy: "admin-a",
    createdAt,
  };
}

async function createActivePackage(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: "POST",
    url: "/admin/course-packages",
    headers: headers(),
    payload: {
      courseId: "course-a",
      name: "编程月卡",
      description: "4 次课",
      creditCount: 4,
      validityMonths: 1,
      priceCents: 120000,
      absentDeductsCredit: true,
      lateCancellationDeductsCredit: true,
      status: "ACTIVE",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data as { id: string };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("课包领域", () => {
  it("按自然月计算月末到期日", () => {
    expect(addCalendarMonths(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(addCalendarMonths(new Date("2024-01-31T00:00:00.000Z"), 1).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  it("按 Asia/Shanghai 将时间转换为业务日期", () => {
    expect(shanghaiBusinessDate(new Date("2026-01-31T15:59:59.999Z")).toISOString()).toBe(
      "2026-01-31T00:00:00.000Z",
    );
    expect(shanghaiBusinessDate(new Date("2026-01-31T16:00:00.000Z")).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("Memory saveCoursePackage 仅允许匹配期望 version 的 CAS 更新", async () => {
    const repository = seedRepository();
    const item: CoursePackage = {
      id: "package-cas",
      version: 0,
      courseId: "course-a",
      name: "CAS 课包",
      description: null,
      creditCount: 10,
      validityMonths: 3,
      priceCents: 1000,
      absentDeductsCredit: false,
      lateCancellationDeductsCredit: false,
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };
    await expect(repository.saveCoursePackage("org-a", item)).resolves.toBe(true);
    await expect(
      repository.saveCoursePackage("org-a", { ...item, version: 1, name: "首次更新" }, 0),
    ).resolves.toBe(true);
    await expect(
      repository.saveCoursePackage("org-a", { ...item, version: 1, name: "过期更新" }, 0),
    ).resolves.toBe(false);
    await expect(repository.getCoursePackage("org-a", item.id)).resolves.toMatchObject({
      version: 1,
      name: "首次更新",
    });
  });

  it("Prisma 更新旧 reservation 时不修改 entitlementId", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      creditReservation: { upsert },
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);
    const reservation: CreditReservation = {
      id: "reservation-a",
      entitlementId: "entitlement-new",
      bookingId: "booking-a",
      credits: 1,
      status: "RESERVED",
      expiresAt: new Date("2026-09-10T03:00:00.000Z"),
      releasedAt: null,
      consumedAt: null,
      settlementAttemptCount: 0,
      nextSettlementAttemptAt: null,
      settlementLastError: null,
      createdAt: now,
      updatedAt: now,
    };

    await repository.saveCreditReservation("org-a", reservation);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_bookingId: {
            organizationId: "org-a",
            bookingId: "booking-a",
          },
        },
        update: expect.objectContaining({ status: "RESERVED" }),
      }),
    );
    expect(upsert.mock.calls[0]?.[0].update).not.toHaveProperty("entitlementId");
  });

  it("迁移按流水类型约束关联字段并限制金额范围", async () => {
    const migration = await readFile(
      new URL("../prisma/migrations/20260910000000_course_packages/migration.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('"CoursePackage_priceCents_range"');
    expect(migration).toContain('"CoursePurchase_paidAmountCents_range"');
    expect(migration).toContain('"CoursePackage_creditCount_range"');
    expect(migration).toContain('"CoursePurchase_creditCount_range"');
    expect(migration).toContain('"creditCount" <= 2147483647');
    expect(migration).toContain('"CreditLedger_link_shape"');
    expect(migration).toContain('"type" IN (\'RESERVE\', \'RELEASE\', \'CONSUME\')');
    expect(migration).toContain('"type" = \'REVERSAL\'');
  });
});

describe("管理员课包 API", () => {
  it("CORS 预检允许 Idempotency-Key", async () => {
    const repository = seedRepository();
    const app = buildApp(repository, {
      developmentIdentityEnabled: true,
      corsOrigins: ["https://admin.example.com"],
    });
    apps.push(app);

    const response = await app.inject({
      method: "OPTIONS",
      url: "/admin/course-package-purchases",
      headers: {
        origin: "https://admin.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,idempotency-key",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-headers"]).toContain("Idempotency-Key");
  });

  it("支持创建、列表、编辑和状态修改，并拒绝非管理员及非法状态", async () => {
    const { app } = createApp();
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/course-packages",
      headers: headers("org-a", "TEACHER", "teacher-a"),
    });
    expect(forbidden.statusCode).toBe(403);

    const created = await createActivePackage(app);
    const listed = await app.inject({
      method: "GET",
      url: "/admin/course-packages?page=1&pageSize=10&keyword=月卡",
      headers: headers(),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(listed.json().data.items[0]).toMatchObject({
      id: created.id,
      version: 0,
      courseName: "编程课",
      soldCount: 0,
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/course-packages/${created.id}`,
      headers: headers(),
      payload: { name: "编程月卡进阶", priceCents: 130000 },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().data).toMatchObject({
      name: "编程月卡进阶",
      priceCents: 130000,
      version: 1,
    });

    const disabled = await app.inject({
      method: "PATCH",
      url: `/admin/course-packages/${created.id}/status`,
      headers: headers(),
      payload: { status: "INACTIVE" },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().data.status).toBe("INACTIVE");
    expect(disabled.json().data.version).toBe(2);

    const invalid = await app.inject({
      method: "PATCH",
      url: `/admin/course-packages/${created.id}`,
      headers: headers(),
      payload: { status: "UNKNOWN", unexpected: true },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("编辑和状态修改使用 version CAS，版本冲突返回 409", async () => {
    class ConflictingRepository extends MemoryRepository {
      override async saveCoursePackage(
        organizationId: string,
        item: CoursePackage,
        expectedVersion?: number,
      ): Promise<boolean> {
        if (expectedVersion !== undefined) return false;
        return super.saveCoursePackage(organizationId, item, expectedVersion);
      }
    }
    const base = seedRepository();
    const course = await base.getMasterData("org-a", "courses", "course-a");
    const repository = new ConflictingRepository({
      organizations: ["org-a"],
      users: [{ id: "admin-a", organizationId: "org-a", role: "ADMIN" }],
      masterData: { courses: [{ ...course!, organizationId: "org-a" }] },
    });
    const { app } = createApp(repository);
    const coursePackage = await createActivePackage(app);

    for (const request of [
      {
        url: `/admin/course-packages/${coursePackage.id}`,
        payload: { name: "冲突名称" },
      },
      {
        url: `/admin/course-packages/${coursePackage.id}/status`,
        payload: { status: "INACTIVE" },
      },
    ]) {
      const response = await app.inject({
        method: "PATCH",
        headers: headers(),
        ...request,
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("COURSE_PACKAGE_CONFLICT");
    }
  });

  it("严格校验购买时间 RFC3339、非法日历日与数据库整数金额上限", async () => {
    const { app } = createApp();
    const coursePackage = await createActivePackage(app);
    for (const [index, purchasedAt] of [
      "2026-02-30T10:00:00Z",
      "2026-01-31",
      "2026-01-31 10:00:00Z",
      "2026-01-31T10:00:00",
      "2026-01-31T24:00:00Z",
    ].entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/admin/course-package-purchases",
        headers: { ...headers(), "idempotency-key": `invalid-date-${index}` },
        payload: { packageId: coursePackage.id, studentId: "student-a", purchasedAt },
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe("INVALID_DATE");
    }

    const oversizedPurchase = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "oversized-amount" },
      payload: {
        packageId: coursePackage.id,
        studentId: "student-a",
        paidAmountCents: 2_147_483_648,
      },
    });
    expect(oversizedPurchase.statusCode).toBe(400);

    const oversizedPackage = await app.inject({
      method: "POST",
      url: "/admin/course-packages",
      headers: headers(),
      payload: {
        courseId: "course-a",
        name: "超额课包",
        creditCount: 1,
        validityMonths: 1,
        priceCents: 2_147_483_648,
      },
    });
    expect(oversizedPackage.statusCode).toBe(400);
  });

  it("creditCount 接受 2147483647 并拒绝 2147483648", async () => {
    const service = new CoursePackageService(
      seedRepository(),
      "org-a",
      "admin-a",
      () => now,
      () => "service-package",
    );
    await expect(
      service.createPackage({
        courseId: "course-a",
        name: "服务层越界课包",
        creditCount: 2_147_483_648,
        validityMonths: 1,
        priceCents: 0,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDIT_COUNT",
      statusCode: 400,
    });

    const { app } = createApp();
    const maximum = await app.inject({
      method: "POST",
      url: "/admin/course-packages",
      headers: headers(),
      payload: {
        courseId: "course-a",
        name: "最大课时课包",
        creditCount: 2_147_483_647,
        validityMonths: 1,
        priceCents: 0,
      },
    });
    expect(maximum.statusCode, maximum.body).toBe(201);
    expect(maximum.json().data.creditCount).toBe(2_147_483_647);

    const oversized = await app.inject({
      method: "POST",
      url: "/admin/course-packages",
      headers: headers(),
      payload: {
        courseId: "course-a",
        name: "越界课时课包",
        creditCount: 2_147_483_648,
        validityMonths: 1,
        priceCents: 0,
      },
    });
    expect(oversized.statusCode).toBe(400);
  });

  it("购买列表只统计具有权益的购买，确保 total 与 items 一致", async () => {
    const repository = seedRepository();
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    await repository.saveCoursePurchase("org-a", {
      id: "orphan-purchase",
      packageId: "missing-package",
      packageNameSnapshot: "历史课包",
      courseId: "course-a",
      courseNameSnapshot: "编程课",
      studentId: "student-a",
      creditCount: 1,
      validityMonths: 1,
      paidAmountCents: 100,
      status: "PAID",
      purchasedAt: timestamp,
      note: null,
      createdBy: "admin-a",
      idempotencyKey: "orphan",
      requestFingerprint: "fingerprint",
      absentDeductsCreditSnapshot: false,
      lateCancellationDeductsCreditSnapshot: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await expect(
      repository.listCoursePurchases("org-a", { page: 1, pageSize: 20 }),
    ).resolves.toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it("Memory 购买列表在 purchasedAt 相同时按 id 倒序稳定分页", async () => {
    const purchasedAt = new Date("2026-01-20T08:00:00.000Z");
    const purchases = ["purchase-a", "purchase-c", "purchase-b"].map((id) =>
      purchaseRecord(id, purchasedAt),
    );
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      masterData: {
        students: [
          {
            id: "student-a",
            organizationId: "org-a",
            name: "学生甲",
            isActive: true,
            createdAt: purchasedAt,
            updatedAt: purchasedAt,
          },
        ],
      },
      coursePurchases: purchases.map((item) => ({ ...item, organizationId: "org-a" })),
      studentEntitlements: purchases.map((item) => ({
        ...entitlementRecord(item.id, purchasedAt),
        organizationId: "org-a",
      })),
    });

    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        repository.listCoursePurchases("org-a", { page, pageSize: 1 }),
      ),
    );

    expect(pages.map((page) => page.items[0]?.id)).toEqual([
      "purchase-c",
      "purchase-b",
      "purchase-a",
    ]);
    expect(pages.every((page) => page.total === 3)).toBe(true);
  });

  it("Prisma 购买列表使用 purchasedAt desc、id desc 稳定分页", async () => {
    const purchasedAt = new Date("2026-01-20T08:00:00.000Z");
    const rows = ["purchase-a", "purchase-c", "purchase-b"].map((id) => ({
      ...purchaseRecord(id, purchasedAt),
      organizationId: "org-a",
      student: { name: "学生甲" },
      entitlement: { id: `entitlement-${id}` },
    }));
    const findManyCalls: Array<{
      skip: number;
      take: number;
      orderBy: Array<Record<string, "desc">>;
    }> = [];
    const prisma = {
      coursePurchase: {
        findMany: async (args: (typeof findManyCalls)[number]) => {
          findManyCalls.push(args);
          return [...rows]
            .sort(
              (left, right) =>
                right.purchasedAt.getTime() - left.purchasedAt.getTime() ||
                right.id.localeCompare(left.id),
            )
            .slice(args.skip, args.skip + args.take);
        },
        count: async () => rows.length,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);

    const pages = [];
    for (const page of [1, 2, 3]) {
      pages.push(await repository.listCoursePurchases("org-a", { page, pageSize: 1 }));
    }

    expect(findManyCalls.map((call) => call.orderBy)).toEqual([
      [{ purchasedAt: "desc" }, { id: "desc" }],
      [{ purchasedAt: "desc" }, { id: "desc" }],
      [{ purchasedAt: "desc" }, { id: "desc" }],
    ]);
    expect(pages.map((page) => page.items[0]?.id)).toEqual([
      "purchase-c",
      "purchase-b",
      "purchase-a",
    ]);
  });

  it("Memory 课包与权益列表按 createdAt desc、id desc 稳定分页", async () => {
    const createdAt = new Date("2026-01-20T08:00:00.000Z");
    const ids = ["a", "c", "b"];
    const purchases = ids.map((id) => purchaseRecord(`purchase-${id}`, createdAt));
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      masterData: {
        courses: [
          {
            id: "course-a",
            organizationId: "org-a",
            name: "编程课",
            isActive: true,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        students: [
          {
            id: "student-a",
            organizationId: "org-a",
            name: "学生甲",
            isActive: true,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      },
      coursePackages: ids.map((id) => ({
        ...packageRecord(`package-${id}`, createdAt),
        organizationId: "org-a",
      })),
      coursePurchases: purchases.map((item) => ({ ...item, organizationId: "org-a" })),
      studentEntitlements: ids.map((id) => ({
        ...entitlementRecord(`purchase-${id}`, createdAt),
        id: `entitlement-${id}`,
        organizationId: "org-a",
      })),
    });

    const packagePages = await Promise.all(
      [1, 2, 3].map((page) =>
        repository.listCoursePackages("org-a", { page, pageSize: 1 }),
      ),
    );
    const entitlementPages = await Promise.all(
      [1, 2, 3].map((page) =>
        repository.listStudentEntitlements("org-a", { page, pageSize: 1 }),
      ),
    );

    expect(packagePages.map((page) => page.items[0]?.id)).toEqual([
      "package-c",
      "package-b",
      "package-a",
    ]);
    expect(entitlementPages.map((page) => page.items[0]?.id)).toEqual([
      "entitlement-c",
      "entitlement-b",
      "entitlement-a",
    ]);
    expect([...packagePages, ...entitlementPages].every((page) => page.total === 3)).toBe(true);
  });

  it("Prisma 课包与权益列表使用 createdAt desc、id desc 稳定分页", async () => {
    const createdAt = new Date("2026-01-20T08:00:00.000Z");
    const ids = ["a", "c", "b"];
    const packageRows = ids.map((id) => ({
      ...packageRecord(`package-${id}`, createdAt),
      organizationId: "org-a",
      course: { name: "编程课" },
      _count: { purchases: 0 },
    }));
    const entitlementRows = ids.map((id) => ({
      ...entitlementRecord(`purchase-${id}`, createdAt),
      id: `entitlement-${id}`,
      organizationId: "org-a",
      student: { name: "学生甲" },
      purchase: {
        packageNameSnapshot: "编程月卡",
        courseNameSnapshot: "编程课",
      },
    }));
    const packageCalls: Array<{ orderBy: Array<Record<string, "desc">> }> = [];
    const entitlementCalls: Array<{ orderBy: Array<Record<string, "desc">> }> = [];
    const sortAndPage = <T extends { id: string; createdAt: Date }>(
      rows: T[],
      args: { skip: number; take: number },
    ) =>
      [...rows]
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(args.skip, args.skip + args.take);
    const prisma = {
      coursePackage: {
        findMany: async (args: { skip: number; take: number; orderBy: Array<Record<string, "desc">> }) => {
          packageCalls.push(args);
          return sortAndPage(packageRows, args);
        },
        count: async () => packageRows.length,
      },
      studentCourseEntitlement: {
        findMany: async (args: { skip: number; take: number; orderBy: Array<Record<string, "desc">> }) => {
          entitlementCalls.push(args);
          return sortAndPage(entitlementRows, args);
        },
        count: async () => entitlementRows.length,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);

    const packagePages = [];
    const entitlementPages = [];
    for (const page of [1, 2, 3]) {
      packagePages.push(await repository.listCoursePackages("org-a", { page, pageSize: 1 }));
      entitlementPages.push(
        await repository.listStudentEntitlements("org-a", { page, pageSize: 1 }),
      );
    }

    const expectedOrder = [{ createdAt: "desc" }, { id: "desc" }];
    expect(packageCalls.map((call) => call.orderBy)).toEqual([
      expectedOrder,
      expectedOrder,
      expectedOrder,
    ]);
    expect(entitlementCalls.map((call) => call.orderBy)).toEqual([
      expectedOrder,
      expectedOrder,
      expectedOrder,
    ]);
    expect(packagePages.map((page) => page.items[0]?.id)).toEqual([
      "package-c",
      "package-b",
      "package-a",
    ]);
    expect(entitlementPages.map((page) => page.items[0]?.id)).toEqual([
      "entitlement-c",
      "entitlement-b",
      "entitlement-a",
    ]);
  });

  it("Memory 列表请求超过 total 时快速返回空页并保留总数语义", async () => {
    const createdAt = new Date("2026-01-20T08:00:00.000Z");
    const purchase = purchaseRecord("purchase-a", createdAt);
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      masterData: {
        courses: [
          {
            id: "course-a",
            organizationId: "org-a",
            name: "编程课",
            isActive: true,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        students: [
          {
            id: "student-a",
            organizationId: "org-a",
            name: "学生甲",
            isActive: true,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      },
      coursePackages: [{ ...packageRecord("package-a", createdAt), organizationId: "org-a" }],
      coursePurchases: [{ ...purchase, organizationId: "org-a" }],
      studentEntitlements: [
        {
          ...entitlementRecord(purchase.id, createdAt),
          organizationId: "org-a",
        },
      ],
    });

    const pages = await Promise.all([
      repository.listCoursePackages("org-a", { page: 101, pageSize: 100 }),
      repository.listCoursePurchases("org-a", { page: 101, pageSize: 100 }),
      repository.listStudentEntitlements("org-a", { page: 101, pageSize: 100 }),
    ]);

    expect(pages).toEqual([
      { items: [], page: 101, pageSize: 100, total: 1 },
      { items: [], page: 101, pageSize: 100, total: 1 },
      { items: [], page: 101, pageSize: 100, total: 1 },
    ]);
  });

  it("Prisma 列表在 offset 已超过 total 时不执行 findMany", async () => {
    const coursePackageFindMany = vi.fn();
    const coursePurchaseFindMany = vi.fn();
    const entitlementFindMany = vi.fn();
    const prisma = {
      coursePackage: {
        count: vi.fn().mockResolvedValue(3),
        findMany: coursePackageFindMany,
      },
      coursePurchase: {
        count: vi.fn().mockResolvedValue(3),
        findMany: coursePurchaseFindMany,
      },
      studentCourseEntitlement: {
        count: vi.fn().mockResolvedValue(3),
        findMany: entitlementFindMany,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);
    const query = { page: 11, pageSize: 100 };

    await expect(repository.listCoursePackages("org-a", query)).resolves.toEqual({
      items: [],
      page: 11,
      pageSize: 100,
      total: 3,
    });
    await expect(repository.listCoursePurchases("org-a", query)).resolves.toEqual({
      items: [],
      page: 11,
      pageSize: 100,
      total: 3,
    });
    await expect(repository.listStudentEntitlements("org-a", query)).resolves.toEqual({
      items: [],
      page: 11,
      pageSize: 100,
      total: 3,
    });
    expect(coursePackageFindMany).not.toHaveBeenCalled();
    expect(coursePurchaseFindMany).not.toHaveBeenCalled();
    expect(entitlementFindMany).not.toHaveBeenCalled();
  });

  it("课包分页拒绝产生超过 10000 的 offset", async () => {
    const { app } = createApp();

    const response = await app.inject({
      method: "GET",
      url: "/admin/course-packages?page=102&pageSize=100",
      headers: headers(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PAGINATION");
  });

  it("Memory 流水与延期记录返回 total 并按时间、id 倒序稳定分页", async () => {
    const occurredAt = new Date("2026-01-20T08:00:00.000Z");
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      creditLedgers: ["a", "c", "b"].map((id) => ({
        ...ledgerRecord(`ledger-${id}`, occurredAt),
        organizationId: "org-a",
      })),
      entitlementValidityChanges: ["a", "c", "b"].map((id) => ({
        ...validityChangeRecord(`change-${id}`, occurredAt),
        organizationId: "org-a",
      })),
    });

    const ledgerPages = await Promise.all([
      repository.listCreditLedgerPage("org-a", "entitlement-a", { page: 1, pageSize: 2 }),
      repository.listCreditLedgerPage("org-a", "entitlement-a", { page: 2, pageSize: 2 }),
    ]);
    const validityPages = await Promise.all([
      repository.listEntitlementValidityChanges(
        "org-a",
        "entitlement-a",
        { page: 1, pageSize: 2 },
      ),
      repository.listEntitlementValidityChanges(
        "org-a",
        "entitlement-a",
        { page: 2, pageSize: 2 },
      ),
    ]);

    expect(ledgerPages.map((page) => page.items.map((item) => item.id))).toEqual([
      ["ledger-c", "ledger-b"],
      ["ledger-a"],
    ]);
    expect(validityPages.map((page) => page.items.map((item) => item.id))).toEqual([
      ["change-c", "change-b"],
      ["change-a"],
    ]);
    expect([...ledgerPages, ...validityPages].every((page) => page.total === 3)).toBe(true);
  });

  it("Memory 流水与延期记录按关键词过滤 items 和 total", async () => {
    const occurredAt = new Date("2026-01-20T08:00:00.000Z");
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      creditLedgers: [
        {
          ...ledgerRecord("consume", occurredAt),
          type: "CONSUME",
          actorId: "teacher-wang",
          organizationId: "org-a",
        },
        {
          ...ledgerRecord("note", occurredAt),
          note: "家长补偿",
          actorId: "admin-a",
          organizationId: "org-a",
        },
        {
          ...ledgerRecord("actor", occurredAt),
          actorId: "finance-li",
          organizationId: "org-a",
        },
      ],
      entitlementValidityChanges: [
        {
          ...validityChangeRecord("change-leave", occurredAt),
          reason: "停课补偿",
          organizationId: "org-a",
        },
        {
          ...validityChangeRecord("change-other", occurredAt),
          reason: "运营调整",
          organizationId: "org-a",
        },
      ],
    });

    for (const [keyword, expectedId] of [
      ["消课", "consume"],
      ["补偿", "note"],
      ["FINANCE", "actor"],
    ] as const) {
      await expect(repository.listCreditLedgerPage(
        "org-a",
        "entitlement-a",
        { page: 1, pageSize: 1, keyword },
      )).resolves.toMatchObject({
        total: 1,
        items: [expect.objectContaining({ id: expectedId })],
      });
    }
    await expect(repository.listEntitlementValidityChanges(
      "org-a",
      "entitlement-a",
      { page: 1, pageSize: 1, keyword: "停课" },
    )).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: "change-leave" })],
    });
  });

  it("Prisma 流水与延期记录使用稳定排序、分页参数和 count", async () => {
    const occurredAt = new Date("2026-01-20T08:00:00.000Z");
    const ledgerRows = ["a", "c", "b"].map((id) => ({
      ...ledgerRecord(`ledger-${id}`, occurredAt),
      organizationId: "org-a",
    }));
    const validityRows = ["a", "c", "b"].map((id) => ({
      ...validityChangeRecord(`change-${id}`, occurredAt),
      organizationId: "org-a",
    }));
    const ledgerFindMany = vi.fn(async (args: {
      skip: number;
      take: number;
      where: Prisma.CreditLedgerWhereInput;
    }) =>
      [...ledgerRows]
        .sort((left, right) => right.id.localeCompare(left.id))
        .slice(args.skip, args.skip + args.take),
    );
    const validityFindMany = vi.fn(async (args: {
      skip: number;
      take: number;
      where: Prisma.EntitlementValidityChangeWhereInput;
    }) =>
      [...validityRows]
        .sort((left, right) => right.id.localeCompare(left.id))
        .slice(args.skip, args.skip + args.take),
    );
    const ledgerCount = vi.fn().mockResolvedValue(3);
    const validityCount = vi.fn().mockResolvedValue(3);
    const prisma = {
      creditLedger: {
        count: ledgerCount,
        findMany: ledgerFindMany,
      },
      entitlementValidityChange: {
        count: validityCount,
        findMany: validityFindMany,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaRepository(prisma);

    const ledgerPage = await repository.listCreditLedgerPage(
      "org-a",
      "entitlement-a",
      { page: 2, pageSize: 1, keyword: "消课" },
    );
    const validityPage = await repository.listEntitlementValidityChanges(
      "org-a",
      "entitlement-a",
      { page: 2, pageSize: 1, keyword: "停课" },
    );

    expect(ledgerPage).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect(validityPage).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect(ledgerFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-a",
        entitlementId: "entitlement-a",
        OR: [
          { type: { in: ["CONSUME"] } },
          { note: { contains: "消课", mode: "insensitive" } },
          { actorId: { contains: "消课", mode: "insensitive" } },
        ],
      },
      skip: 1,
      take: 1,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    }));
    expect(validityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-a",
        entitlementId: "entitlement-a",
        reason: { contains: "停课", mode: "insensitive" },
      },
      skip: 1,
      take: 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }));
    expect(ledgerCount).toHaveBeenCalledWith({
      where: ledgerFindMany.mock.calls[0]?.[0].where,
    });
    expect(validityCount).toHaveBeenCalledWith({
      where: validityFindMany.mock.calls[0]?.[0].where,
    });
  });

  it("流水与延期接口支持分页并将 pageSize 上限限制为 100", async () => {
    let clock = now;
    const { app } = createApp(seedRepository(), () => clock);
    const coursePackage = await createActivePackage(app);
    const purchased = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "detail-page" },
      payload: { packageId: coursePackage.id, studentId: "student-a" },
    });
    const entitlementId = purchased.json().data.entitlement.id as string;
    for (const [version, reason] of ["第一次延期", "第二次延期"].entries()) {
      clock = new Date(now.getTime() + (version + 1) * 1000);
      const extended = await app.inject({
        method: "POST",
        url: `/admin/student-entitlements/${entitlementId}/extensions`,
        headers: headers(),
        payload: { months: 1, reason, version },
      });
      expect(extended.statusCode, extended.body).toBe(200);
    }

    const ledger = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${entitlementId}/ledger?page=1&pageSize=1`,
      headers: headers(),
    });
    expect(ledger.json().data).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      items: [expect.objectContaining({ type: "PURCHASE" })],
    });
    const validity = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${entitlementId}/validity-changes?page=2&pageSize=1`,
      headers: headers(),
    });
    expect(validity.json().data).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      items: [expect.objectContaining({ reason: "第一次延期" })],
    });

    for (const suffix of ["ledger", "validity-changes"]) {
      const oversized = await app.inject({
        method: "GET",
        url: `/admin/student-entitlements/${entitlementId}/${suffix}?pageSize=101`,
        headers: headers(),
      });
      expect(oversized.statusCode).toBe(400);
      expect(oversized.json().error.code).toBe("INVALID_PAGINATION");
    }
  });

  it("原子录入购买并支持购买、权益和流水查询及请求幂等", async () => {
    const { app, repository } = createApp();
    const coursePackage = await createActivePackage(app);
    const purchaseRequest = {
      method: "POST" as const,
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "purchase-request-1" },
      payload: {
        packageId: coursePackage.id,
        studentId: "student-a",
        purchasedAt: now.toISOString(),
        note: "线下收款",
      },
    };

    const purchased = await app.inject(purchaseRequest);
    expect(purchased.statusCode, purchased.body).toBe(201);
    expect(purchased.json().data.alreadyPurchased).toBe(false);
    expect(purchased.json().data.purchase).toMatchObject({
      packageId: coursePackage.id,
      studentId: "student-a",
      creditCount: 4,
      paidAmountCents: 120000,
    });
    expect(purchased.json().data.entitlement).toMatchObject({
      totalCredits: 4,
      remainingCredits: 4,
      reservedCredits: 0,
      validFrom: "2026-01-31T00:00:00.000Z",
      validUntil: "2026-02-28T00:00:00.000Z",
    });

    const repeated = await app.inject(purchaseRequest);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().data.alreadyPurchased).toBe(true);
    expect(repeated.json().data.purchase.id).toBe(purchased.json().data.purchase.id);

    const purchases = await app.inject({
      method: "GET",
      url: "/admin/course-package-purchases?studentId=student-a",
      headers: headers(),
    });
    expect(purchases.statusCode).toBe(200);
    expect(purchases.json().data.total).toBe(1);

    const entitlements = await app.inject({
      method: "GET",
      url: "/admin/student-entitlements?studentId=student-a",
      headers: headers(),
    });
    expect(entitlements.statusCode).toBe(200);
    expect(entitlements.json().data.total).toBe(1);
    const entitlementId = entitlements.json().data.items[0].id as string;

    const detail = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${entitlementId}`,
      headers: headers(),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      studentName: "学生甲",
      packageName: "编程月卡",
      courseName: "编程课",
    });

    const ledger = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${entitlementId}/ledger`,
      headers: headers(),
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().data).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [
        expect.objectContaining({
          type: "PURCHASE",
          creditDelta: 4,
          balanceAfter: 4,
          idempotencyKey: "purchase:purchase-request-1",
        }),
      ],
    });

    const auditLogs = await repository.listAuditLogs("org-a");
    expect(
      auditLogs.filter((item) => item.action === "COURSE_PACKAGE_PURCHASED"),
    ).toHaveLength(1);
  });

  it("购买幂等键绑定原请求，且所有查询严格按租户隔离", async () => {
    const { app } = createApp();
    const coursePackage = await createActivePackage(app);
    const first = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "same-key" },
      payload: { packageId: coursePackage.id, studentId: "student-a" },
    });
    expect(first.statusCode).toBe(201);

    const conflict = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "same-key" },
      payload: { packageId: coursePackage.id, studentId: "student-a2" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");

    const foreignPackages = await app.inject({
      method: "GET",
      url: "/admin/course-packages",
      headers: headers("org-b", "ADMIN", "admin-b"),
    });
    expect(foreignPackages.json().data.total).toBe(0);

    const foreignEntitlement = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${first.json().data.entitlement.id}`,
      headers: headers("org-b", "ADMIN", "admin-b"),
    });
    expect(foreignEntitlement.statusCode).toBe(404);
  });

  it("使用 SHA-256 指纹绑定规范化完整请求，并区分省略值", async () => {
    const { app } = createApp();
    const coursePackage = await createActivePackage(app);
    const url = "/admin/course-package-purchases";

    const first = await app.inject({
      method: "POST",
      url,
      headers: { ...headers(), "idempotency-key": "fingerprint-normalized" },
      payload: {
        packageId: coursePackage.id,
        studentId: "student-a",
        paidAmountCents: 120000,
        purchasedAt: "2026-01-31T15:45:00.000Z",
        note: " 线下收款 ",
      },
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().data.purchase.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const normalizedRepeat = await app.inject({
      method: "POST",
      url,
      headers: { ...headers(), "idempotency-key": "fingerprint-normalized" },
      payload: {
        packageId: coursePackage.id,
        studentId: "student-a",
        paidAmountCents: 120000,
        purchasedAt: "2026-01-31T23:45:00.000+08:00",
        note: "线下收款",
      },
    });
    expect(normalizedRepeat.statusCode, normalizedRepeat.body).toBe(200);

    for (const payload of [
      {
        packageId: coursePackage.id,
        studentId: "student-a",
        paidAmountCents: 119999,
        purchasedAt: "2026-01-31T15:45:00.000Z",
        note: "线下收款",
      },
      {
        packageId: coursePackage.id,
        studentId: "student-a",
        paidAmountCents: 120000,
        purchasedAt: "2026-02-01T15:45:00.000Z",
        note: "线下收款",
      },
      {
        packageId: coursePackage.id,
        studentId: "student-a",
        paidAmountCents: 120000,
        purchasedAt: "2026-01-31T15:45:00.000Z",
        note: "其他备注",
      },
    ]) {
      const conflict = await app.inject({
        method: "POST",
        url,
        headers: { ...headers(), "idempotency-key": "fingerprint-normalized" },
        payload,
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.json().error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    }

    const omitted = await app.inject({
      method: "POST",
      url,
      headers: { ...headers(), "idempotency-key": "fingerprint-omitted" },
      payload: { packageId: coursePackage.id, studentId: "student-a2" },
    });
    expect(omitted.statusCode, omitted.body).toBe(201);

    const explicitDefault = await app.inject({
      method: "POST",
      url,
      headers: { ...headers(), "idempotency-key": "fingerprint-omitted" },
      payload: {
        packageId: coursePackage.id,
        studentId: "student-a2",
        paidAmountCents: 120000,
      },
    });
    expect(explicitDefault.statusCode, explicitDefault.body).toBe(409);
  });

  it("使用上海业务日期创建权益并在列表与详情前过期 ACTIVE 权益", async () => {
    let clock = new Date("2026-01-31T16:30:00.000Z");
    const { app } = createApp(seedRepository(), () => clock);
    const coursePackage = await createActivePackage(app);
    const purchased = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "shanghai-date" },
      payload: { packageId: coursePackage.id, studentId: "student-a" },
    });
    expect(purchased.statusCode, purchased.body).toBe(201);
    expect(purchased.json().data.entitlement).toMatchObject({
      validFrom: "2026-02-01T00:00:00.000Z",
      validUntil: "2026-03-01T00:00:00.000Z",
      status: "ACTIVE",
    });

    const entitlementId = purchased.json().data.entitlement.id as string;
    clock = new Date("2026-03-01T16:00:00.000Z");
    const detail = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${entitlementId}`,
      headers: headers(),
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().data).toMatchObject({ status: "EXPIRED", version: 1 });

    const active = await app.inject({
      method: "GET",
      url: "/admin/student-entitlements?status=ACTIVE",
      headers: headers(),
    });
    expect(active.json().data.total).toBe(0);
    const expired = await app.inject({
      method: "GET",
      url: "/admin/student-entitlements?status=EXPIRED",
      headers: headers(),
    });
    expect(expired.json().data.total).toBe(1);
  });

  it("回填历史购买时立即创建 EXPIRED 权益且状态筛选准确", async () => {
    const currentTime = new Date("2026-05-01T16:00:00.000Z");
    const { app } = createApp(seedRepository(), () => currentTime);
    const coursePackage = await createActivePackage(app);
    const purchased = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "backdated-expired" },
      payload: {
        packageId: coursePackage.id,
        studentId: "student-a",
        purchasedAt: "2026-01-31T16:00:00.000Z",
      },
    });

    expect(purchased.statusCode, purchased.body).toBe(201);
    expect(purchased.json().data.entitlement).toMatchObject({
      validFrom: "2026-02-01T00:00:00.000Z",
      validUntil: "2026-03-01T00:00:00.000Z",
      status: "EXPIRED",
    });

    const active = await app.inject({
      method: "GET",
      url: "/admin/student-entitlements?status=ACTIVE",
      headers: headers(),
    });
    expect(active.json().data.total).toBe(0);

    const expired = await app.inject({
      method: "GET",
      url: "/admin/student-entitlements?status=EXPIRED",
      headers: headers(),
    });
    expect(expired.json().data).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ status: "EXPIRED" })],
    });

    const detail = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${purchased.json().data.entitlement.id}`,
      headers: headers(),
    });
    expect(detail.json().data.status).toBe("EXPIRED");
  });

  it("购买记录固化扣课策略且权益名称读取购买快照", async () => {
    const { app } = createApp();
    const coursePackage = await createActivePackage(app);
    const purchased = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "policy-snapshot" },
      payload: { packageId: coursePackage.id, studentId: "student-a" },
    });
    expect(purchased.statusCode, purchased.body).toBe(201);
    expect(purchased.json().data.purchase).toMatchObject({
      packageNameSnapshot: "编程月卡",
      courseNameSnapshot: "编程课",
      absentDeductsCreditSnapshot: true,
      lateCancellationDeductsCreditSnapshot: true,
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/course-packages/${coursePackage.id}`,
      headers: headers(),
      payload: {
        name: "已改名课包",
        absentDeductsCredit: false,
        lateCancellationDeductsCredit: false,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: `/admin/student-entitlements/${purchased.json().data.entitlement.id}`,
      headers: headers(),
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().data).toMatchObject({
      packageName: "编程月卡",
      courseName: "编程课",
    });
  });

  it("拒绝跨租户学生、非在售课包和缺失幂等键", async () => {
    const { app } = createApp();
    const coursePackage = await createActivePackage(app);
    const missingKey = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: headers(),
      payload: { packageId: coursePackage.id, studentId: "student-a" },
    });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const crossTenant = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "cross-tenant" },
      payload: { packageId: coursePackage.id, studentId: "student-b" },
    });
    expect(crossTenant.statusCode).toBe(400);
    expect(crossTenant.json().error.code).toBe("STUDENT_UNAVAILABLE");

    await app.inject({
      method: "PATCH",
      url: `/admin/course-packages/${coursePackage.id}/status`,
      headers: headers(),
      payload: { status: "INACTIVE" },
    });
    const inactive = await app.inject({
      method: "POST",
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "inactive-package" },
      payload: { packageId: coursePackage.id, studentId: "student-a" },
    });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().error.code).toBe("COURSE_PACKAGE_NOT_FOR_SALE");
  });
});

describe("购买事务", () => {
  it("audit 写入失败时回滚 purchase、entitlement 和 PURCHASE ledger", async () => {
    class FailingAuditRepository extends MemoryRepository {
      failPurchaseAudit = true;

      override async saveAuditLog(organizationId: string, auditLog: AuditLog): Promise<void> {
        if (this.failPurchaseAudit && auditLog.action === "COURSE_PACKAGE_PURCHASED") {
          throw new Error("audit unavailable");
        }
        await super.saveAuditLog(organizationId, auditLog);
      }
    }

    const base = seedRepository();
    const course = await base.getMasterData("org-a", "courses", "course-a");
    expect(course).toBeDefined();
    const repository = new FailingAuditRepository({
      organizations: ["org-a"],
      users: [{ id: "admin-a", organizationId: "org-a", role: "ADMIN" }],
      students: [
        { id: "student-a", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
      ],
      masterData: { courses: [{ ...course!, organizationId: "org-a" }] },
      coursePackages: [
        {
          id: "package-a",
          version: 0,
          organizationId: "org-a",
          courseId: "course-a",
          name: "事务课包",
          description: null,
          creditCount: 8,
          validityMonths: 2,
          priceCents: 200000,
          absentDeductsCredit: false,
          lateCancellationDeductsCredit: false,
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const { app } = createApp(repository);
    const request = {
      method: "POST" as const,
      url: "/admin/course-package-purchases",
      headers: { ...headers(), "idempotency-key": "rollback-key" },
      payload: { packageId: "package-a", studentId: "student-a" },
    };

    const failed = await app.inject(request);
    expect(failed.statusCode).toBe(500);
    expect(
      await repository.listCoursePurchases("org-a", { page: 1, pageSize: 20 }),
    ).toMatchObject({ total: 0, items: [] });
    expect(
      await repository.listStudentEntitlements("org-a", { page: 1, pageSize: 20 }),
    ).toMatchObject({ total: 0, items: [] });

    repository.failPurchaseAudit = false;
    const retried = await app.inject(request);
    expect(retried.statusCode, retried.body).toBe(201);
    const entitlementId = retried.json().data.entitlement.id as string;
    expect(await repository.listCreditLedgers("org-a", entitlementId)).toHaveLength(1);
    expect(
      await repository.listCoursePurchases("org-a", { page: 1, pageSize: 20 }),
    ).toMatchObject({ total: 1 });
  });
});
