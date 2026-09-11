import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { DomainError, type Repository, type UserIdentity } from "./domain.js";

export type CoursePackageStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
export type CoursePurchaseStatus = "PAID" | "CANCELLED" | "REFUNDED";
export type EntitlementStatus = "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
export type CreditLedgerType =
  | "PURCHASE"
  | "RESERVE"
  | "RELEASE"
  | "CONSUME"
  | "REFUND"
  | "ADJUSTMENT"
  | "REVERSAL";

const creditLedgerTypeSearchTerms: Record<CreditLedgerType, readonly string[]> = {
  PURCHASE: ["purchase", "购课", "购买"],
  RESERVE: ["reserve", "预占"],
  RELEASE: ["release", "释放"],
  CONSUME: ["consume", "消课"],
  REFUND: ["refund", "退款"],
  ADJUSTMENT: ["adjustment", "调整"],
  REVERSAL: ["reversal", "冲正"],
};

export function creditLedgerTypesMatchingKeyword(keyword: string): CreditLedgerType[] {
  const normalized = keyword.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return (Object.entries(creditLedgerTypeSearchTerms) as Array<
    [CreditLedgerType, readonly string[]]
  >)
    .filter(([, terms]) => terms.some((term) => term.includes(normalized)))
    .map(([type]) => type);
}

export interface CoursePackage {
  id: string;
  version: number;
  courseId: string;
  name: string;
  description: string | null;
  creditCount: number;
  validityMonths: number;
  priceCents: number;
  absentDeductsCredit: boolean;
  lateCancellationDeductsCredit: boolean;
  status: CoursePackageStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoursePackageListItem extends CoursePackage {
  courseName: string;
  soldCount: number;
}

export interface CoursePurchase {
  id: string;
  packageId: string;
  packageNameSnapshot: string;
  courseId: string;
  courseNameSnapshot: string;
  studentId: string;
  creditCount: number;
  validityMonths: number;
  paidAmountCents: number;
  status: CoursePurchaseStatus;
  purchasedAt: Date;
  note: string | null;
  createdBy: string;
  idempotencyKey: string;
  requestFingerprint: string;
  absentDeductsCreditSnapshot: boolean;
  lateCancellationDeductsCreditSnapshot: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoursePurchaseListItem extends CoursePurchase {
  studentName: string;
  entitlementId: string;
}

export interface StudentCourseEntitlement {
  id: string;
  purchaseId: string;
  packageId: string;
  courseId: string;
  studentId: string;
  totalCredits: number;
  remainingCredits: number;
  reservedCredits: number;
  version: number;
  validFrom: Date;
  validUntil: Date;
  status: EntitlementStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type CreditReservationStatus = "RESERVED" | "CONSUMED" | "RELEASED" | "EXPIRED";

export interface CreditReservation {
  id: string;
  entitlementId: string;
  bookingId: string;
  credits: number;
  status: CreditReservationStatus;
  expiresAt: Date | null;
  releasedAt: Date | null;
  consumedAt: Date | null;
  settlementAttemptCount: number;
  nextSettlementAttemptAt: Date | null;
  settlementLastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntitlementValidityChange {
  id: string;
  entitlementId: string;
  previousValidUntil: Date;
  newValidUntil: Date;
  reason: string;
  changedBy: string;
  createdAt: Date;
}

export interface EntitlementListItem extends StudentCourseEntitlement {
  studentName: string;
  packageName: string;
  courseName: string;
}

export interface CreditLedger {
  id: string;
  entitlementId: string;
  purchaseId: string | null;
  reservationId: string | null;
  bookingId: string | null;
  idempotencyKey: string;
  type: CreditLedgerType;
  creditDelta: number;
  balanceAfter: number;
  reservedCreditDelta: number;
  reservedBalanceAfter: number;
  reversalOfId: string | null;
  actorId: string;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface PageQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  courseId?: string;
  studentId?: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const MAX_COURSE_PACKAGE_PAGE_OFFSET = 10_000;

export function coursePackagePageOffset(query: Pick<PageQuery, "page" | "pageSize">): number {
  const offset = (query.page - 1) * query.pageSize;
  if (!Number.isSafeInteger(offset) || offset > MAX_COURSE_PACKAGE_PAGE_OFFSET) {
    throw new DomainError(
      "INVALID_PAGINATION",
      `分页偏移量不能超过 ${MAX_COURSE_PACKAGE_PAGE_OFFSET}`,
      400,
    );
  }
  return offset;
}

export interface CoursePackageRepository {
  listCoursePackages(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<CoursePackageListItem>>;
  getCoursePackage(
    organizationId: string,
    id: string,
  ): Promise<CoursePackageListItem | undefined>;
  saveCoursePackage(
    organizationId: string,
    item: CoursePackage,
    expectedVersion?: number,
  ): Promise<boolean>;
  findCoursePurchaseByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<CoursePurchaseListItem | undefined>;
  listCoursePurchases(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<CoursePurchaseListItem>>;
  saveCoursePurchase(organizationId: string, item: CoursePurchase): Promise<void>;
  listStudentEntitlements(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<EntitlementListItem>>;
  getStudentEntitlement(
    organizationId: string,
    id: string,
  ): Promise<EntitlementListItem | undefined>;
  saveStudentEntitlement(
    organizationId: string,
    item: StudentCourseEntitlement,
    expectedVersion?: number,
  ): Promise<boolean>;
  listUsableStudentEntitlements(
    organizationId: string,
    studentId: string,
    courseId: string,
    businessDate: Date,
  ): Promise<StudentCourseEntitlement[]>;
  getCoursePurchase(
    organizationId: string,
    id: string,
  ): Promise<CoursePurchase | undefined>;
  getCreditReservationByBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<CreditReservation | undefined>;
  listExpiredCreditReservations(
    organizationId: string,
    expiresAt: Date,
    limit: number,
    excludedReservationIds?: readonly string[],
  ): Promise<CreditReservation[]>;
  saveCreditReservation(
    organizationId: string,
    item: CreditReservation,
  ): Promise<void>;
  saveCreditReservationSettlementFailure(
    organizationId: string,
    item: Pick<
      CreditReservation,
      | "id"
      | "settlementAttemptCount"
      | "nextSettlementAttemptAt"
      | "settlementLastError"
      | "updatedAt"
    >,
    expectedAttemptCount: number,
  ): Promise<boolean>;
  expireStudentEntitlements(
    organizationId: string,
    businessDate: Date,
    updatedAt: Date,
  ): Promise<void>;
  listCreditLedgers(organizationId: string, entitlementId: string): Promise<CreditLedger[]>;
  listCreditLedgerPage(
    organizationId: string,
    entitlementId: string,
    query: PageQuery,
  ): Promise<Page<CreditLedger>>;
  listBookingCreditLedgers(organizationId: string, bookingId: string): Promise<CreditLedger[]>;
  saveCreditLedger(organizationId: string, item: CreditLedger): Promise<void>;
  listEntitlementValidityChanges(
    organizationId: string,
    entitlementId: string,
    query: PageQuery,
  ): Promise<Page<EntitlementValidityChange>>;
  saveEntitlementValidityChange(
    organizationId: string,
    item: EntitlementValidityChange,
  ): Promise<void>;
}

export interface CoursePackageInput {
  courseId: string;
  name: string;
  description?: string | null;
  creditCount: number;
  validityMonths: number;
  priceCents: number;
  absentDeductsCredit?: boolean;
  lateCancellationDeductsCredit?: boolean;
  status?: CoursePackageStatus;
}

export interface PurchaseInput {
  packageId: string;
  studentId: string;
  paidAmountCents?: number;
  purchasedAt?: Date;
  note?: string | null;
  idempotencyKey: string;
}

export interface ExtendEntitlementInput {
  months: number;
  reason: string;
  version: number;
}

export class CoursePackageService {
  constructor(
    private readonly repository: Repository,
    private readonly organizationId: string,
    private readonly actorId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  listPackages(query: PageQuery) {
    return this.repository.listCoursePackages(this.organizationId, query);
  }

  async getPackage(id: string): Promise<CoursePackageListItem> {
    const item = await this.repository.getCoursePackage(this.organizationId, id);
    if (!item) throw new DomainError("COURSE_PACKAGE_NOT_FOUND", "课包不存在", 404);
    return item;
  }

  async createPackage(input: CoursePackageInput): Promise<CoursePackageListItem> {
    const normalized = await this.validatePackageInput(input);
    const timestamp = this.now();
    const item: CoursePackage = {
      id: this.createId(),
      version: 0,
      ...normalized,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.withTransaction(async () => {
      await this.repository.saveCoursePackage(this.organizationId, item);
      await this.audit("COURSE_PACKAGE_CREATED", "CoursePackage", item.id, normalized);
    });
    return this.getPackage(item.id);
  }

  async updatePackage(
    id: string,
    input: Partial<CoursePackageInput>,
  ): Promise<CoursePackageListItem> {
    const current = await this.getPackage(id);
    const normalized = await this.validatePackageInput({
      courseId: input.courseId ?? current.courseId,
      name: input.name ?? current.name,
      description: input.description === undefined ? current.description : input.description,
      creditCount: input.creditCount ?? current.creditCount,
      validityMonths: input.validityMonths ?? current.validityMonths,
      priceCents: input.priceCents ?? current.priceCents,
      absentDeductsCredit: input.absentDeductsCredit ?? current.absentDeductsCredit,
      lateCancellationDeductsCredit:
        input.lateCancellationDeductsCredit ?? current.lateCancellationDeductsCredit,
      status: input.status ?? current.status,
    });
    const updated: CoursePackage = {
      id: current.id,
      version: current.version + 1,
      ...normalized,
      createdAt: current.createdAt,
      updatedAt: this.now(),
    };
    await this.repository.withTransaction(async () => {
      if (
        !(await this.repository.saveCoursePackage(
          this.organizationId,
          updated,
          current.version,
        ))
      ) {
        throw new DomainError("COURSE_PACKAGE_CONFLICT", "课包已被其他操作修改，请刷新后重试", 409);
      }
      await this.audit("COURSE_PACKAGE_UPDATED", "CoursePackage", id, normalized);
    });
    return this.getPackage(id);
  }

  async setPackageStatus(id: string, status: CoursePackageStatus) {
    if (!["DRAFT", "ACTIVE", "INACTIVE"].includes(status)) {
      throw new DomainError("INVALID_PACKAGE_STATUS", "课包状态无效", 400);
    }
    const current = await this.getPackage(id);
    const updated: CoursePackage = {
      ...current,
      status,
      version: current.version + 1,
      updatedAt: this.now(),
    };
    await this.repository.withTransaction(async () => {
      if (
        !(await this.repository.saveCoursePackage(
          this.organizationId,
          updated,
          current.version,
        ))
      ) {
        throw new DomainError("COURSE_PACKAGE_CONFLICT", "课包已被其他操作修改，请刷新后重试", 409);
      }
      await this.audit("COURSE_PACKAGE_STATUS_CHANGED", "CoursePackage", id, { status });
    });
    return this.getPackage(id);
  }

  listPurchases(query: PageQuery) {
    return this.repository.listCoursePurchases(this.organizationId, query);
  }

  async purchase(input: PurchaseInput): Promise<{
    purchase: CoursePurchaseListItem;
    entitlement: EntitlementListItem;
    alreadyPurchased: boolean;
  }> {
    const key = input.idempotencyKey.trim();
    if (!key || key.length > 128) {
      throw new DomainError("INVALID_IDEMPOTENCY_KEY", "幂等键不能为空且最多 128 个字符", 400);
    }
    const paidAmountCents = input.paidAmountCents;
    if (
      paidAmountCents !== undefined &&
      (!Number.isSafeInteger(paidAmountCents) ||
        paidAmountCents < 0 ||
        paidAmountCents > 2_147_483_647)
    ) {
      throw new DomainError("INVALID_AMOUNT", "实收金额必须是 0 到 2147483647 的整数分", 400);
    }
    if (input.purchasedAt && Number.isNaN(input.purchasedAt.getTime())) {
      throw new DomainError("INVALID_DATE", "购买时间不是有效日期", 400);
    }
    const requestFingerprint = purchaseRequestFingerprint(input);

    try {
      return await this.repository.withTransaction(async () => {
        const existing = await this.findIdempotentPurchase(key, requestFingerprint);
        if (existing) return existing;

        const [coursePackage, student] = await Promise.all([
          this.repository.getCoursePackage(this.organizationId, input.packageId),
          this.repository.getMasterData(this.organizationId, "students", input.studentId),
        ]);
        if (!coursePackage || coursePackage.status !== "ACTIVE") {
          throw new DomainError("COURSE_PACKAGE_NOT_FOR_SALE", "课包不存在或不在售", 409);
        }
        if (!student?.isActive) {
          throw new DomainError("STUDENT_UNAVAILABLE", "学生不存在、已停用或不属于当前机构", 400);
        }
        const course = await this.repository.getMasterData(
          this.organizationId,
          "courses",
          coursePackage.courseId,
        );
        if (!course?.isActive) {
          throw new DomainError("COURSE_UNAVAILABLE", "课程不存在、已停用或不属于当前机构", 400);
        }

        const currentTimestamp = this.now();
        const timestamp = input.purchasedAt ?? currentTimestamp;
        const purchaseId = this.createId();
        const entitlementId = this.createId();
        const ledgerId = this.createId();
        const validFrom = shanghaiBusinessDate(timestamp);
        const validUntil = addCalendarMonths(validFrom, coursePackage.validityMonths);
        const entitlementStatus =
          validUntil < shanghaiBusinessDate(currentTimestamp) ? "EXPIRED" : "ACTIVE";
        const purchase: CoursePurchase = {
          id: purchaseId,
          packageId: coursePackage.id,
          packageNameSnapshot: coursePackage.name,
          courseId: course.id,
          courseNameSnapshot: course.name,
          studentId: student.id,
          creditCount: coursePackage.creditCount,
          validityMonths: coursePackage.validityMonths,
          paidAmountCents: paidAmountCents ?? coursePackage.priceCents,
          status: "PAID",
          purchasedAt: timestamp,
          note: normalizeOptionalText(input.note),
          createdBy: this.actorId,
          idempotencyKey: key,
          requestFingerprint,
          absentDeductsCreditSnapshot: coursePackage.absentDeductsCredit,
          lateCancellationDeductsCreditSnapshot:
            coursePackage.lateCancellationDeductsCredit,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const entitlement: StudentCourseEntitlement = {
          id: entitlementId,
          purchaseId,
          packageId: coursePackage.id,
          courseId: course.id,
          studentId: student.id,
          totalCredits: coursePackage.creditCount,
          remainingCredits: coursePackage.creditCount,
          reservedCredits: 0,
          version: 0,
          validFrom,
          validUntil,
          status: entitlementStatus,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const ledger: CreditLedger = {
          id: ledgerId,
          entitlementId,
          purchaseId,
          reservationId: null,
          bookingId: null,
          idempotencyKey: `purchase:${key}`,
          type: "PURCHASE",
          creditDelta: coursePackage.creditCount,
          balanceAfter: coursePackage.creditCount,
          reservedCreditDelta: 0,
          reservedBalanceAfter: 0,
          reversalOfId: null,
          actorId: this.actorId,
          note: purchase.note,
          occurredAt: timestamp,
          createdAt: timestamp,
        };
        await this.repository.saveCoursePurchase(this.organizationId, purchase);
        await this.repository.saveStudentEntitlement(this.organizationId, entitlement);
        await this.repository.saveCreditLedger(this.organizationId, ledger);
        await this.audit("COURSE_PACKAGE_PURCHASED", "CoursePurchase", purchaseId, {
          packageId: coursePackage.id,
          studentId: student.id,
          entitlementId,
          ledgerId,
          paidAmountCents: purchase.paidAmountCents,
          idempotencyKey: key,
        });
        const savedPurchase = await this.repository.findCoursePurchaseByIdempotencyKey(
          this.organizationId,
          key,
        );
        const savedEntitlement = await this.repository.getStudentEntitlement(
          this.organizationId,
          entitlementId,
        );
        if (!savedPurchase || !savedEntitlement) {
          throw new Error("购买事务写入后无法读取");
        }
        return {
          purchase: savedPurchase,
          entitlement: savedEntitlement,
          alreadyPurchased: false,
        };
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "IDEMPOTENCY_KEY_CONFLICT") {
        const existing = await this.findIdempotentPurchase(key, requestFingerprint);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async listEntitlements(query: PageQuery) {
    await this.expireEntitlements();
    return this.repository.listStudentEntitlements(this.organizationId, query);
  }

  async getEntitlement(id: string): Promise<EntitlementListItem> {
    return this.requireEntitlement(id);
  }

  async listLedger(entitlementId: string, query: PageQuery): Promise<Page<CreditLedger>> {
    await this.requireEntitlement(entitlementId);
    return this.repository.listCreditLedgerPage(this.organizationId, entitlementId, query);
  }

  async extendEntitlement(
    id: string,
    input: ExtendEntitlementInput,
  ): Promise<EntitlementListItem> {
    if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120) {
      throw new DomainError("INVALID_EXTENSION_MONTHS", "延期月数必须为 1 到 120 个自然月", 400);
    }
    if (!Number.isInteger(input.version) || input.version < 0) {
      throw new DomainError("INVALID_VERSION", "version 必须是非负整数", 400);
    }
    const reason = input.reason.trim();
    if (!reason) {
      throw new DomainError("EXTENSION_REASON_REQUIRED", "延期原因不能为空", 400);
    }
    await this.repository.withTransaction(async () => {
      const current = await this.repository.getStudentEntitlement(this.organizationId, id);
      if (!current) throw new DomainError("ENTITLEMENT_NOT_FOUND", "学生权益不存在", 404);
      if (current.version !== input.version) {
        throw new DomainError("ENTITLEMENT_CONFLICT", "权益已被其他操作修改，请刷新后重试", 409);
      }
      if (current.status === "CANCELLED") {
        throw new DomainError("ENTITLEMENT_NOT_EXTENDABLE", "当前权益不可延期", 409);
      }
      const timestamp = this.now();
      const newValidUntil = addCalendarMonths(current.validUntil, input.months);
      const businessDate = shanghaiBusinessDate(timestamp);
      const updated: StudentCourseEntitlement = {
        ...current,
        validUntil: newValidUntil,
        status:
          current.remainingCredits === 0
            ? "EXHAUSTED"
            : newValidUntil < businessDate
              ? "EXPIRED"
              : "ACTIVE",
        version: current.version + 1,
        updatedAt: timestamp,
      };
      if (
        !(await this.repository.saveStudentEntitlement(
          this.organizationId,
          updated,
          current.version,
        ))
      ) {
        throw new DomainError("ENTITLEMENT_CONFLICT", "权益已被其他操作修改，请刷新后重试", 409);
      }
      const change: EntitlementValidityChange = {
        id: this.createId(),
        entitlementId: id,
        previousValidUntil: current.validUntil,
        newValidUntil,
        reason,
        changedBy: this.actorId,
        createdAt: timestamp,
      };
      await this.repository.saveEntitlementValidityChange(this.organizationId, change);
      await this.audit("ENTITLEMENT_VALIDITY_EXTENDED", "StudentCourseEntitlement", id, {
        months: input.months,
        reason,
        previousValidUntil: current.validUntil.toISOString(),
        newValidUntil: newValidUntil.toISOString(),
        version: updated.version,
      });
    });
    return this.requireEntitlement(id);
  }

  async listValidityChanges(
    id: string,
    query: PageQuery,
  ): Promise<Page<EntitlementValidityChange>> {
    await this.requireEntitlement(id);
    return this.repository.listEntitlementValidityChanges(this.organizationId, id, query);
  }

  private async validatePackageInput(input: CoursePackageInput) {
    const name = input.name.trim();
    if (!name) throw new DomainError("VALIDATION_ERROR", "课包名称不能为空", 400);
    if (
      !Number.isSafeInteger(input.creditCount) ||
      input.creditCount <= 0 ||
      input.creditCount > 2_147_483_647
    ) {
      throw new DomainError(
        "INVALID_CREDIT_COUNT",
        "课时数必须是 1 到 2147483647 的整数",
        400,
      );
    }
    if (
      !Number.isSafeInteger(input.validityMonths) ||
      input.validityMonths <= 0 ||
      input.validityMonths > 120
    ) {
      throw new DomainError("INVALID_VALIDITY_MONTHS", "有效期必须为 1 到 120 个自然月", 400);
    }
    if (
      !Number.isSafeInteger(input.priceCents) ||
      input.priceCents < 0 ||
      input.priceCents > 2_147_483_647
    ) {
      throw new DomainError("INVALID_AMOUNT", "课包金额必须是 0 到 2147483647 的整数分", 400);
    }
    const course = await this.repository.getMasterData(
      this.organizationId,
      "courses",
      input.courseId,
    );
    if (!course?.isActive) {
      throw new DomainError("COURSE_UNAVAILABLE", "课程不存在、已停用或不属于当前机构", 400);
    }
    return {
      courseId: course.id,
      name,
      description: normalizeOptionalText(input.description),
      creditCount: input.creditCount,
      validityMonths: input.validityMonths,
      priceCents: input.priceCents,
      absentDeductsCredit: input.absentDeductsCredit ?? false,
      lateCancellationDeductsCredit: input.lateCancellationDeductsCredit ?? false,
      status: input.status ?? "DRAFT",
    };
  }

  private async findIdempotentPurchase(
    key: string,
    requestFingerprint: string,
  ): Promise<
    | {
        purchase: CoursePurchaseListItem;
        entitlement: EntitlementListItem;
        alreadyPurchased: true;
      }
    | undefined
  > {
    const existing = await this.repository.findCoursePurchaseByIdempotencyKey(
      this.organizationId,
      key,
    );
    if (!existing) return undefined;
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new DomainError("IDEMPOTENCY_KEY_CONFLICT", "幂等键已用于其他购买请求", 409);
    }
    const entitlement = await this.requireEntitlement(existing.entitlementId);
    return { purchase: existing, entitlement, alreadyPurchased: true };
  }

  private async requireEntitlement(id: string): Promise<EntitlementListItem> {
    await this.expireEntitlements();
    const item = await this.repository.getStudentEntitlement(this.organizationId, id);
    if (!item) throw new DomainError("ENTITLEMENT_NOT_FOUND", "学生权益不存在", 404);
    return item;
  }

  private async expireEntitlements(): Promise<void> {
    const timestamp = this.now();
    await this.repository.expireStudentEntitlements(
      this.organizationId,
      shanghaiBusinessDate(timestamp),
      timestamp,
    );
  }

  private async audit(action: string, entityType: string, entityId: string, details: unknown) {
    await this.repository.saveAuditLog(this.organizationId, {
      id: this.createId(),
      actorId: this.actorId,
      action,
      entityType,
      entityId,
      details,
      createdAt: this.now(),
    });
  }
}

export function shanghaiBusinessDate(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

export function addCalendarMonths(source: Date, months: number): Date {
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const targetFirst = new Date(Date.UTC(year, month + months, 1));
  const targetLastDay = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetFirst.getUTCFullYear(),
      targetFirst.getUTCMonth(),
      Math.min(day, targetLastDay),
    ),
  );
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value.trim() || null;
}

function purchaseRequestFingerprint(input: PurchaseInput): string {
  const omitted = { state: "OMITTED" } as const;
  const normalized = {
    packageId: input.packageId,
    studentId: input.studentId,
    paidAmountCents:
      input.paidAmountCents === undefined ? omitted : { state: "VALUE", value: input.paidAmountCents },
    purchasedAt:
      input.purchasedAt === undefined
        ? omitted
        : { state: "VALUE", value: input.purchasedAt.toISOString() },
    note:
      input.note === undefined
        ? omitted
        : { state: "VALUE", value: normalizeOptionalText(input.note) },
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function parseRfc3339(value: string): Date {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) {
    throw new DomainError("INVALID_DATE", "购买时间必须是严格 RFC3339 格式", 400);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetText] =
    match;
  const offset = offsetText!;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const invalidCalendarDate =
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day;
  const offsetHours = offset === "Z" ? 0 : Number(offset.slice(1, 3));
  const offsetMinutes = offset === "Z" ? 0 : Number(offset.slice(4, 6));
  if (
    invalidCalendarDate ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHours > 23 ||
    offsetMinutes > 59
  ) {
    throw new DomainError("INVALID_DATE", "购买时间包含无效的日期或时间", 400);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("INVALID_DATE", "购买时间不是有效日期", 400);
  }
  return parsed;
}

function parsePage(
  query: Record<string, string | undefined>,
  allowedStatuses: readonly string[],
): PageQuery {
  const integer = (value: string | undefined, fallback: number, maximum: number) => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new DomainError("INVALID_PAGINATION", "分页参数格式不正确", 400);
    }
    return parsed;
  };
  if (query.status && !allowedStatuses.includes(query.status)) {
    throw new DomainError("INVALID_STATUS", "状态筛选值无效", 400);
  }
  const pageQuery: PageQuery = {
    page: integer(query.page, 1, 1_000_000),
    pageSize: integer(query.pageSize, 20, 100),
    ...(query.keyword ? { keyword: query.keyword.trim() } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.courseId ? { courseId: query.courseId } : {}),
    ...(query.studentId ? { studentId: query.studentId } : {}),
  };
  coursePackagePageOffset(pageQuery);
  return pageQuery;
}

const packageBodySchema = {
  type: "object",
  required: ["courseId", "name", "creditCount", "validityMonths", "priceCents"],
  properties: {
    courseId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: ["string", "null"], maxLength: 2000 },
    creditCount: { type: "integer", minimum: 1, maximum: 2147483647 },
    validityMonths: { type: "integer", minimum: 1, maximum: 120 },
    priceCents: { type: "integer", minimum: 0, maximum: 2147483647 },
    absentDeductsCredit: { type: "boolean" },
    lateCancellationDeductsCredit: { type: "boolean" },
    status: { type: "string", enum: ["DRAFT", "ACTIVE", "INACTIVE"] },
  },
  additionalProperties: false,
} as const;

const packagePatchBodySchema = {
  type: "object",
  properties: packageBodySchema.properties,
  additionalProperties: false,
} as const;

export function registerCoursePackageRoutes(
  app: FastifyInstance,
  repository: Repository,
  authorizeAdmin: (request: { auth: UserIdentity }) => Promise<void>,
  now?: () => Date,
): void {
  const serviceFor = (identity: UserIdentity) =>
    new CoursePackageService(repository, identity.organizationId, identity.id, now);
  const admin = { preHandler: authorizeAdmin };

  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/admin/course-packages",
    admin,
    async (request) => ({
      data: await serviceFor(request.auth).listPackages(
        parsePage(request.query, ["DRAFT", "ACTIVE", "INACTIVE"]),
      ),
    }),
  );
  app.get<{ Params: { id: string } }>("/admin/course-packages/:id", admin, async (request) => ({
    data: await serviceFor(request.auth).getPackage(request.params.id),
  }));
  app.post<{ Body: CoursePackageInput }>(
    "/admin/course-packages",
    { ...admin, schema: { body: packageBodySchema } },
    async (request, reply) =>
      reply.status(201).send({ data: await serviceFor(request.auth).createPackage(request.body) }),
  );
  app.patch<{ Params: { id: string }; Body: Partial<CoursePackageInput> }>(
    "/admin/course-packages/:id",
    { ...admin, schema: { body: packagePatchBodySchema } },
    async (request) => ({
      data: await serviceFor(request.auth).updatePackage(request.params.id, request.body),
    }),
  );
  app.patch<{ Params: { id: string }; Body: { status: CoursePackageStatus } }>(
    "/admin/course-packages/:id/status",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: ["DRAFT", "ACTIVE", "INACTIVE"] } },
          additionalProperties: false,
        },
      },
    },
    async (request) => ({
      data: await serviceFor(request.auth).setPackageStatus(
        request.params.id,
        request.body.status,
      ),
    }),
  );
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/admin/course-package-purchases",
    admin,
    async (request) => ({
      data: await serviceFor(request.auth).listPurchases(
        parsePage(request.query, ["PAID", "CANCELLED", "REFUNDED"]),
      ),
    }),
  );
  app.post<{
    Body: Omit<PurchaseInput, "purchasedAt" | "idempotencyKey"> & {
      purchasedAt?: string;
      idempotencyKey?: string;
    };
  }>(
    "/admin/course-package-purchases",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["packageId", "studentId"],
          properties: {
            packageId: { type: "string", minLength: 1 },
            studentId: { type: "string", minLength: 1 },
            paidAmountCents: { type: "integer", minimum: 0, maximum: 2147483647 },
            purchasedAt: { type: "string" },
            note: { type: ["string", "null"], maxLength: 1000 },
            idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const headerKey = request.headers["idempotency-key"];
      const key =
        (typeof headerKey === "string" ? headerKey : undefined) ?? request.body.idempotencyKey;
      if (!key) {
        throw new DomainError("IDEMPOTENCY_KEY_REQUIRED", "购买请求必须提供 Idempotency-Key", 400);
      }
      const purchasedAt =
        request.body.purchasedAt === undefined
          ? undefined
          : parseRfc3339(request.body.purchasedAt);
      const result = await serviceFor(request.auth).purchase({
        packageId: request.body.packageId,
        studentId: request.body.studentId,
        ...(request.body.paidAmountCents === undefined
          ? {}
          : { paidAmountCents: request.body.paidAmountCents }),
        ...(request.body.note === undefined ? {} : { note: request.body.note }),
        idempotencyKey: key,
        ...(purchasedAt ? { purchasedAt } : {}),
      });
      return reply.status(result.alreadyPurchased ? 200 : 201).send({ data: result });
    },
  );
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/admin/student-entitlements",
    admin,
    async (request) => ({
      data: await serviceFor(request.auth).listEntitlements(
        parsePage(request.query, ["ACTIVE", "EXHAUSTED", "EXPIRED", "CANCELLED"]),
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/admin/student-entitlements/:id",
    admin,
    async (request) => ({
      data: await serviceFor(request.auth).getEntitlement(request.params.id),
    }),
  );
  app.post<{ Params: { id: string }; Body: ExtendEntitlementInput }>(
    "/admin/student-entitlements/:id/extensions",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["months", "reason", "version"],
          properties: {
            months: { type: "integer", minimum: 1, maximum: 120 },
            reason: { type: "string", minLength: 1, maxLength: 500 },
            version: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => ({
      data: await serviceFor(request.auth).extendEntitlement(request.params.id, request.body),
    }),
  );
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    "/admin/student-entitlements/:id/validity-changes",
    admin,
    async (request) => ({
      data: await serviceFor(request.auth).listValidityChanges(
        request.params.id,
        parsePage(request.query, []),
      ),
    }),
  );
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    "/admin/student-entitlements/:id/ledger",
    admin,
    async (request) => ({
      data: await serviceFor(request.auth).listLedger(
        request.params.id,
        parsePage(request.query, []),
      ),
    }),
  );
}
