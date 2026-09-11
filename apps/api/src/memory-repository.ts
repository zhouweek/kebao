import { AsyncLocalStorage } from "node:async_hooks";
import {
  DomainError,
  type AdminBookingFilter,
  type AdminBookingPage,
  type AuditLog,
  type Booking,
  type CourseSession,
  type Notification,
  type NotificationDelivery,
  type AdminNotificationDelivery,
  type Repository,
  type ScheduleSeries,
  type SessionFilter,
  type Student,
  type UserIdentity,
} from "./domain.js";
import type { AuthSession, AuthUser } from "./auth.js";
import type {
  PlatformAccount,
  PlatformAudit,
  PlatformOrganization,
  PlatformRepository,
  PlatformSession,
  PlatformTenantAdmin,
} from "./platform.js";
import type {
  MasterDataItem,
  MasterDataPage,
  MasterDataQuery,
  MasterResource,
} from "./master-data.js";
import type {
  CoursePackage,
  CoursePackageListItem,
  CoursePurchase,
  CoursePurchaseListItem,
  CreditLedger,
  CreditReservation,
  EntitlementValidityChange,
  EntitlementListItem,
  Page,
  PageQuery,
  StudentCourseEntitlement,
} from "./course-packages.js";
import {
  coursePackagePageOffset,
  creditLedgerTypesMatchingKeyword,
} from "./course-packages.js";

type TenantItem<T> = T & { organizationId?: string };

export interface MemorySeed {
  organizations?: Array<string | { id: string; code: string }>;
  users?: Array<
    UserIdentity &
      Partial<
        Pick<
          AuthUser,
          "name" | "phone" | "passwordHash" | "wechatOpenId" | "isActive" | "mustChangePassword"
        >
      >
  >;
  authSessions?: AuthSession[];
  platformAccounts?: Array<
    Omit<PlatformAccount, "mustChangePassword"> &
      Partial<Pick<PlatformAccount, "mustChangePassword">>
  >;
  guardians?: Array<{ organizationId: string; guardianId: string; studentId: string }>;
  sessions?: Array<TenantItem<CourseSession>>;
  students?: Array<TenantItem<Student>>;
  bookings?: Array<TenantItem<Booking>>;
  notifications?: Array<TenantItem<Notification>>;
  notificationDeliveries?: Array<TenantItem<NotificationDelivery>>;
  auditLogs?: Array<TenantItem<AuditLog>>;
  series?: Array<TenantItem<ScheduleSeries>>;
  masterData?: Partial<Record<MasterResource, Array<TenantItem<MasterDataItem>>>>;
  coursePackages?: Array<TenantItem<CoursePackage>>;
  coursePurchases?: Array<TenantItem<CoursePurchase>>;
  studentEntitlements?: Array<TenantItem<StudentCourseEntitlement>>;
  creditLedgers?: Array<TenantItem<CreditLedger>>;
  creditReservations?: Array<TenantItem<CreditReservation>>;
  entitlementValidityChanges?: Array<TenantItem<EntitlementValidityChange>>;
}

/**
 * 本仓储只用于本地开发和测试。
 * `withSessionLock` 将同一课次的预约串行化，模拟数据库事务中的行锁。
 */
export class MemoryRepository implements Repository, PlatformRepository {
  private readonly organizations = new Map<string, string>();
  private readonly organizationRecords = new Map<string, PlatformOrganization>();
  private readonly users = new Map<string, AuthUser>();
  private readonly authSessions = new Map<string, AuthSession>();
  private readonly platformAccounts = new Map<string, PlatformAccount>();
  private readonly platformSessions = new Map<string, PlatformSession>();
  private readonly platformAudits = new Map<string, PlatformAudit>();
  private readonly tenantAdminEmails = new Map<string, string | null>();
  private readonly guardians = new Set<string>();
  private readonly sessions = new Map<string, TenantItem<CourseSession>>();
  private readonly students = new Map<string, TenantItem<Student>>();
  private readonly bookings = new Map<string, TenantItem<Booking>>();
  private readonly notifications = new Map<string, TenantItem<Notification>>();
  private readonly notificationDeliveries = new Map<string, TenantItem<NotificationDelivery>>();
  private readonly auditLogs = new Map<string, TenantItem<AuditLog>>();
  private readonly series = new Map<string, TenantItem<ScheduleSeries>>();
  private readonly masterData = new Map<string, TenantItem<MasterDataItem> & { resource: MasterResource }>();
  private readonly coursePackages = new Map<string, TenantItem<CoursePackage>>();
  private readonly coursePurchases = new Map<string, TenantItem<CoursePurchase>>();
  private readonly studentEntitlements = new Map<string, TenantItem<StudentCourseEntitlement>>();
  private readonly creditLedgers = new Map<string, TenantItem<CreditLedger>>();
  private readonly creditReservations = new Map<string, TenantItem<CreditReservation>>();
  private readonly entitlementValidityChanges = new Map<
    string,
    TenantItem<EntitlementValidityChange>
  >();
  private readonly lockTails = new Map<string, Promise<void>>();
  private readonly transactions = new AsyncLocalStorage<boolean>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(seed: MemorySeed = {}) {
    this.organizations.set("org-development", "DEMO");
    this.saveOrganization({ id: "org-development", code: "DEMO", name: "开发机构" });
    seed.organizations?.forEach((organization) => {
      const item =
        typeof organization === "string"
          ? { id: organization, code: organization }
          : organization;
      const code = item.code.trim().toUpperCase();
      this.organizations.set(item.id, code);
      this.saveOrganization({ id: item.id, code, name: item.code });
    });
    seed.users?.forEach((user) => {
      if (!this.organizations.has(user.organizationId)) {
        this.organizations.set(user.organizationId, user.organizationId);
      }
      this.users.set(
        this.key(user.organizationId, user.id),
        structuredClone({
          ...user,
          name: user.name ?? user.id,
          phone: user.phone ?? null,
          passwordHash: user.passwordHash ?? null,
          wechatOpenId: user.wechatOpenId ?? null,
          isActive: user.isActive ?? true,
          mustChangePassword: user.mustChangePassword ?? false,
        }),
      );
    });
    seed.authSessions?.forEach((session) =>
      this.authSessions.set(session.id, structuredClone(session)),
    );
    seed.platformAccounts?.forEach((account) =>
      this.platformAccounts.set(
        account.id,
        structuredClone({ ...account, mustChangePassword: account.mustChangePassword ?? false }),
      ),
    );
    seed.guardians?.forEach((link) => {
      this.guardians.add(this.guardianKey(link.organizationId, link.guardianId, link.studentId));
    });
    seed.sessions?.forEach((item) =>
      this.sessions.set(this.key(item.organizationId, item.id), structuredClone(item)),
    );
    seed.students?.forEach((item) =>
      this.students.set(this.key(item.organizationId, item.id), structuredClone(item)),
    );
    seed.bookings?.forEach((item) =>
      this.bookings.set(this.key(item.organizationId, item.id), structuredClone(item)),
    );
    seed.notifications?.forEach((item) =>
      this.notifications.set(this.key(item.organizationId, item.id), structuredClone(item)),
    );
    seed.notificationDeliveries?.forEach((item) =>
      this.notificationDeliveries.set(
        this.key(item.organizationId, item.id),
        structuredClone(item),
      ),
    );
    seed.auditLogs?.forEach((item) =>
      this.auditLogs.set(this.key(item.organizationId, item.id), structuredClone(item)),
    );
    seed.series?.forEach((item) =>
      this.series.set(this.key(item.organizationId, item.id), structuredClone(item)),
    );
    for (const [resource, items] of Object.entries(seed.masterData ?? {}) as Array<
      [MasterResource, Array<TenantItem<MasterDataItem>>]
    >) {
      items.forEach((item) => this.saveMasterSeed(resource, item));
    }
    seed.coursePackages?.forEach((item) =>
      this.coursePackages.set(
        this.key(item.organizationId, item.id),
        structuredClone({ ...item, organizationId: item.organizationId ?? "org-development" }),
      ),
    );
    seed.coursePurchases?.forEach((item) =>
      this.coursePurchases.set(
        this.key(item.organizationId, item.id),
        structuredClone({ ...item, organizationId: item.organizationId ?? "org-development" }),
      ),
    );
    seed.studentEntitlements?.forEach((item) =>
      this.studentEntitlements.set(
        this.key(item.organizationId, item.id),
        structuredClone({ ...item, organizationId: item.organizationId ?? "org-development" }),
      ),
    );
    seed.creditLedgers?.forEach((item) =>
      this.creditLedgers.set(
        this.key(item.organizationId, item.id),
        structuredClone({ ...item, organizationId: item.organizationId ?? "org-development" }),
      ),
    );
    seed.creditReservations?.forEach((item) =>
      this.creditReservations.set(
        this.key(item.organizationId, item.id),
        structuredClone({
          ...item,
          settlementAttemptCount: item.settlementAttemptCount ?? 0,
          nextSettlementAttemptAt: item.nextSettlementAttemptAt ?? null,
          settlementLastError: item.settlementLastError ?? null,
          organizationId: item.organizationId ?? "org-development",
        }),
      ),
    );
    seed.entitlementValidityChanges?.forEach((item) =>
      this.entitlementValidityChanges.set(
        this.key(item.organizationId, item.id),
        structuredClone({ ...item, organizationId: item.organizationId ?? "org-development" }),
      ),
    );
    seed.users?.forEach((user) => {
      if (user.role !== "ADMIN") {
        const now = new Date();
        this.saveMasterSeed(user.role === "TEACHER" ? "teachers" : "guardians", {
          id: user.id,
          organizationId: user.organizationId,
          name: user.name ?? user.id,
          phone: user.phone ?? null,
          isActive: user.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    seed.students?.forEach((student) => {
      const now = new Date();
      this.saveMasterSeed("students", {
        id: student.id,
        ...(student.organizationId ? { organizationId: student.organizationId } : {}),
        name: student.name,
        phone: null,
        isActive: true,
        guardians: [],
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.organizationRecords.has(organizationId);
  }

  async isOrganizationActive(organizationId: string): Promise<boolean> {
    const record = this.organizationRecords.get(organizationId);
    return Boolean(record?.isActive && !record.deletedAt);
  }

  async listOrganizationIds(): Promise<string[]> {
    return [...this.organizationRecords.values()]
      .filter((item) => item.isActive && !item.deletedAt)
      .map((item) => item.id);
  }

  async getUserIdentity(
    organizationId: string,
    userId: string,
  ): Promise<UserIdentity | undefined> {
    const user = this.users.get(this.key(organizationId, userId));
    return user
      ? { id: user.id, organizationId: user.organizationId, role: user.role }
      : undefined;
  }

  async findAuthUserByOrganizationCodeAndPhone(
    organizationCode: string,
    phone: string,
    role?: AuthUser["role"],
  ): Promise<AuthUser | undefined> {
    const organizationId = [...this.organizations].find(
      ([, code]) => code === organizationCode,
    )?.[0];
    if (!organizationId) return undefined;
    const user = [...this.users.values()].find(
      (item) =>
        item.organizationId === organizationId &&
        item.phone === phone &&
        (!role || item.role === role),
    );
    return user ? structuredClone(user) : undefined;
  }

  async getAuthUser(
    userId: string,
    organizationId: string,
  ): Promise<AuthUser | undefined> {
    return structuredClone(this.users.get(this.key(organizationId, userId)));
  }

  async bindWechatOpenId(
    userId: string,
    organizationId: string,
    openId: string,
  ): Promise<void> {
    const user = this.users.get(this.key(organizationId, userId));
    if (!user) return;
    const duplicate = [...this.users.values()].some(
      (item) =>
        item.organizationId === organizationId &&
        item.id !== userId &&
        item.wechatOpenId === openId,
    );
    if (duplicate) {
      throw new DomainError(
        "WECHAT_IDENTITY_MISMATCH",
        "该微信身份已绑定机构内其他用户",
        401,
      );
    }
    this.users.set(this.key(organizationId, userId), { ...user, wechatOpenId: openId });
  }

  async createAuthSession(session: AuthSession): Promise<void> {
    this.authSessions.set(session.id, structuredClone(session));
  }

  async getAuthSessionById(id: string): Promise<AuthSession | undefined> {
    return structuredClone(this.authSessions.get(id));
  }

  async getAuthSessionByRefreshTokenHash(hash: string): Promise<AuthSession | undefined> {
    const session = [...this.authSessions.values()].find(
      (item) => item.refreshTokenHash === hash,
    );
    return session ? structuredClone(session) : undefined;
  }

  async rotateAuthSession(
    id: string,
    expectedHash: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const session = this.authSessions.get(id);
    if (!session || session.revokedAt || session.refreshTokenHash !== expectedHash) return false;
    this.authSessions.set(id, {
      ...session,
      refreshTokenHash,
      expiresAt,
    });
    return true;
  }

  async revokeAuthSession(id: string): Promise<void> {
    const session = this.authSessions.get(id);
    if (!session) return;
    this.authSessions.set(id, { ...session, revokedAt: new Date() });
  }

  async revokeAllUserSessions(userId: string, organizationId: string): Promise<void> {
    for (const [id, session] of this.authSessions) {
      if (session.userId === userId && session.organizationId === organizationId) {
        this.authSessions.set(id, { ...session, revokedAt: new Date() });
      }
    }
  }

  async updateUserPassword(
    userId: string,
    organizationId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<boolean> {
    const key = this.key(organizationId, userId);
    const user = this.users.get(key);
    if (!user || user.passwordHash !== expectedPasswordHash) return false;
    this.users.set(key, { ...user, passwordHash, mustChangePassword });
    return true;
  }

  async touchUserLastLogin(
    _userId: string,
    _organizationId: string,
    _at: Date,
  ): Promise<void> {
    // 内存仓储不持久化展示字段，仅保持与数据库仓储一致的接口。
  }

  async findPlatformAccount(username: string): Promise<PlatformAccount | undefined> {
    const account = [...this.platformAccounts.values()].find((item) => item.username === username);
    return account ? structuredClone(account) : undefined;
  }

  async getPlatformAccount(id: string): Promise<PlatformAccount | undefined> {
    return structuredClone(this.platformAccounts.get(id));
  }

  async createPlatformSession(session: PlatformSession): Promise<void> {
    this.platformSessions.set(session.id, structuredClone(session));
  }

  async getPlatformSessionById(id: string): Promise<PlatformSession | undefined> {
    return structuredClone(this.platformSessions.get(id));
  }

  async getPlatformSessionByRefreshTokenHash(hash: string): Promise<PlatformSession | undefined> {
    const session = [...this.platformSessions.values()].find(
      (item) => item.refreshTokenHash === hash,
    );
    return session ? structuredClone(session) : undefined;
  }

  async rotatePlatformSession(
    id: string,
    expectedHash: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const session = this.platformSessions.get(id);
    if (!session || session.revokedAt || session.refreshTokenHash !== expectedHash) return false;
    this.platformSessions.set(id, { ...session, refreshTokenHash, expiresAt });
    return true;
  }

  async revokePlatformSession(id: string): Promise<void> {
    const session = this.platformSessions.get(id);
    if (session) this.platformSessions.set(id, { ...session, revokedAt: new Date() });
  }

  async revokeAllPlatformSessions(accountId: string): Promise<void> {
    for (const [id, session] of this.platformSessions) {
      if (session.accountId === accountId) {
        this.platformSessions.set(id, { ...session, revokedAt: new Date() });
      }
    }
  }

  async touchPlatformLastLogin(_accountId: string, _at: Date): Promise<void> {}

  async updatePlatformPassword(
    accountId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<boolean> {
    const account = this.platformAccounts.get(accountId);
    if (!account || account.passwordHash !== expectedPasswordHash) return false;
    this.platformAccounts.set(accountId, {
      ...account,
      passwordHash,
      mustChangePassword,
    });
    return true;
  }

  async listPlatformOrganizations(includeDeleted = false): Promise<PlatformOrganization[]> {
    return [...this.organizationRecords.values()]
      .filter((item) => includeDeleted || !item.deletedAt)
      .map((item) => structuredClone(item));
  }

  async getPlatformOrganization(
    id: string,
    includeDeleted = false,
  ): Promise<PlatformOrganization | undefined> {
    const organization = this.organizationRecords.get(id);
    if (!organization || (!includeDeleted && organization.deletedAt)) return undefined;
    return structuredClone(organization);
  }

  async createPlatformOrganization(input: {
    id: string;
    code: string;
    name: string;
  }): Promise<PlatformOrganization> {
    const normalized = { ...input, code: input.code.trim().toUpperCase() };
    if ([...this.organizationRecords.values()].some((item) => item.code === normalized.code)) {
      throw new DomainError("DUPLICATE_RESOURCE", "机构编码已存在", 409);
    }
    return this.saveOrganization(normalized);
  }

  async updatePlatformOrganization(
    id: string,
    input: { code?: string; name?: string },
  ): Promise<PlatformOrganization> {
    const current = this.requireOrganization(id);
    const normalized = {
      ...input,
      ...(input.code === undefined ? {} : { code: input.code.trim().toUpperCase() }),
    };
    if (
      normalized.code &&
      [...this.organizationRecords.values()].some(
        (item) => item.id !== id && item.code === normalized.code,
      )
    ) {
      throw new DomainError("DUPLICATE_RESOURCE", "机构编码已存在", 409);
    }
    const updated = { ...current, ...normalized, updatedAt: new Date() };
    this.organizationRecords.set(id, updated);
    this.organizations.set(id, updated.code);
    return structuredClone(updated);
  }

  async setPlatformOrganizationActive(
    id: string,
    isActive: boolean,
  ): Promise<PlatformOrganization> {
    const current = this.requireOrganization(id);
    const updated = { ...current, isActive, updatedAt: new Date() };
    this.organizationRecords.set(id, updated);
    if (!isActive) {
      for (const admin of this.users.values()) {
        if (admin.organizationId === id) {
          await this.revokeAllUserSessions(admin.id, id);
        }
      }
    }
    return structuredClone(updated);
  }

  async softDeletePlatformOrganization(id: string): Promise<void> {
    const current = this.requireOrganization(id);
    this.organizationRecords.set(id, {
      ...current,
      isActive: false,
      deletedAt: new Date(),
      updatedAt: new Date(),
    });
    for (const user of this.users.values()) {
      if (user.organizationId === id) await this.revokeAllUserSessions(user.id, id);
    }
  }

  async listPlatformTenantAdmins(organizationId: string): Promise<PlatformTenantAdmin[]> {
    this.requireOrganization(organizationId);
    return [...this.users.values()]
      .filter((item) => item.organizationId === organizationId && item.role === "ADMIN")
      .map((item) => this.toTenantAdmin(item));
  }

  async createPlatformTenantAdmin(input: {
    id: string;
    organizationId: string;
    name: string;
    phone: string;
    email?: string | null;
    passwordHash: string;
  }): Promise<PlatformTenantAdmin> {
    this.requireOrganization(input.organizationId);
    if (
      [...this.users.values()].some(
        (item) => item.organizationId === input.organizationId && item.phone === input.phone,
      )
    ) {
      throw new DomainError("DUPLICATE_RESOURCE", "机构内手机号已存在", 409);
    }
    const user: AuthUser = {
      id: input.id,
      organizationId: input.organizationId,
      role: "ADMIN",
      name: input.name,
      phone: input.phone,
      passwordHash: input.passwordHash,
      wechatOpenId: null,
      isActive: true,
      mustChangePassword: true,
    };
    this.users.set(this.key(input.organizationId, input.id), user);
    this.tenantAdminEmails.set(this.key(input.organizationId, input.id), input.email ?? null);
    return this.toTenantAdmin(user);
  }

  async updatePlatformTenantAdmin(
    organizationId: string,
    userId: string,
    input: { name?: string; phone?: string; email?: string | null },
  ): Promise<PlatformTenantAdmin> {
    const key = this.key(organizationId, userId);
    const user = this.users.get(key);
    if (!user || user.role !== "ADMIN") {
      throw new DomainError("TENANT_ADMIN_NOT_FOUND", "机构管理员不存在", 404);
    }
    if (
      input.phone &&
      [...this.users.values()].some(
        (item) =>
          item.organizationId === organizationId &&
          item.id !== userId &&
          item.phone === input.phone,
      )
    ) {
      throw new DomainError("DUPLICATE_RESOURCE", "机构内手机号已存在", 409);
    }
    const updated = { ...user, ...input };
    delete updated.email;
    this.users.set(key, updated);
    if (input.email !== undefined) this.tenantAdminEmails.set(key, input.email);
    return this.toTenantAdmin(updated);
  }

  async setPlatformTenantAdminActive(
    organizationId: string,
    userId: string,
    isActive: boolean,
  ): Promise<PlatformTenantAdmin> {
    const key = this.key(organizationId, userId);
    const user = this.users.get(key);
    if (!user || user.role !== "ADMIN") {
      throw new DomainError("TENANT_ADMIN_NOT_FOUND", "机构管理员不存在", 404);
    }
    const updated = { ...user, isActive };
    this.users.set(key, updated);
    if (!isActive) await this.revokeAllUserSessions(userId, organizationId);
    return this.toTenantAdmin(updated);
  }

  async resetPlatformTenantAdminPassword(
    organizationId: string,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    const key = this.key(organizationId, userId);
    const user = this.users.get(key);
    if (!user || user.role !== "ADMIN") {
      throw new DomainError("TENANT_ADMIN_NOT_FOUND", "机构管理员不存在", 404);
    }
    this.users.set(key, { ...user, passwordHash, mustChangePassword: true });
    await this.revokeAllUserSessions(userId, organizationId);
  }

  async revokeTenantUserSessions(organizationId: string, userId: string): Promise<void> {
    await this.revokeAllUserSessions(userId, organizationId);
  }

  async savePlatformAudit(log: PlatformAudit): Promise<void> {
    this.platformAudits.set(log.id, structuredClone(log));
  }

  async listPlatformAudits(limit: number): Promise<PlatformAudit[]> {
    return [...this.platformAudits.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }

  async isGuardianOfStudent(
    organizationId: string,
    guardianId: string,
    studentId: string,
  ): Promise<boolean> {
    return this.guardians.has(this.guardianKey(organizationId, guardianId, studentId));
  }

  async listGuardianStudents(
    organizationId: string,
    guardianId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return [...this.students.values()]
      .filter(
        (student) =>
          student.organizationId === organizationId &&
          this.guardians.has(
            this.guardianKey(organizationId, guardianId, student.id),
          ),
      )
      .map((student) => ({ id: student.id, name: student.name }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  async listMasterData(
    organizationId: string,
    resource: MasterResource,
    query: MasterDataQuery,
  ): Promise<MasterDataPage> {
    let items = [...this.masterData.values()].filter(
      (item) => item.resource === resource && item.organizationId === organizationId,
    );
    if (query.activeOnly !== undefined) {
      items = items.filter((item) => item.isActive === query.activeOnly);
    }
    if (query.campusId) {
      items = items.filter((item) => item.campusId === query.campusId);
    }
    if (query.keyword) {
      const keyword = query.keyword.toLocaleLowerCase();
      items = items.filter((item) =>
        [item.name, item.phone, item.email, item.code, item.address]
          .some((value) => value?.toLocaleLowerCase().includes(keyword)),
      );
    }
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = items.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: items.slice(start, start + query.pageSize).map((item) => this.cleanMaster(item)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
  ): Promise<MasterDataItem | undefined> {
    const item = this.masterData.get(this.masterKey(organizationId, resource, id));
    return item ? this.cleanMaster(item) : undefined;
  }

  async createMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
    input: Record<string, unknown>,
  ): Promise<MasterDataItem> {
    await this.validateMasterReferences(organizationId, resource, input);
    this.ensureMasterUnique(organizationId, resource, input);
    const now = new Date();
    const item = {
      ...input,
      id,
      organizationId,
      resource,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    } as TenantItem<MasterDataItem> & { resource: MasterResource };
    this.masterData.set(this.masterKey(organizationId, resource, id), structuredClone(item));
    this.syncMaster(resource, item);
    return this.cleanMaster(item);
  }

  async updateMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
    input: Record<string, unknown>,
  ): Promise<MasterDataItem> {
    const key = this.masterKey(organizationId, resource, id);
    const current = this.masterData.get(key);
    if (!current) throw new DomainError("MASTER_DATA_NOT_FOUND", "基础资料不存在", 404);
    await this.validateMasterReferences(organizationId, resource, input);
    this.ensureMasterUnique(organizationId, resource, input, id);
    const item = {
      ...current,
      ...input,
      id,
      organizationId,
      resource,
      updatedAt: new Date(),
    };
    this.masterData.set(key, structuredClone(item));
    this.syncMaster(resource, item);
    return this.cleanMaster(item);
  }

  async setMasterDataActive(
    organizationId: string,
    resource: MasterResource,
    id: string,
    isActive: boolean,
  ): Promise<MasterDataItem> {
    return this.updateMasterData(organizationId, resource, id, { isActive });
  }

  async deleteMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
  ): Promise<void> {
    const key = this.masterKey(organizationId, resource, id);
    if (!this.masterData.has(key)) {
      throw new DomainError("MASTER_DATA_NOT_FOUND", "基础资料不存在", 404);
    }
    const inUse =
      (resource === "campuses" &&
        [...this.sessions.values()].some((item) => item.organizationId === organizationId && item.campusId === id)) ||
      (resource === "classrooms" &&
        [...this.sessions.values()].some((item) => item.organizationId === organizationId && item.classroomId === id)) ||
      (resource === "courses" &&
        [...this.sessions.values()].some((item) => item.organizationId === organizationId && item.courseId === id)) ||
      (resource === "teachers" &&
        [...this.sessions.values()].some((item) => item.organizationId === organizationId && item.teacherId === id));
    if (inUse) throw new DomainError("MASTER_DATA_IN_USE", "资料已被业务数据使用，请改为停用", 409);
    this.masterData.delete(key);
    if (resource === "teachers" || resource === "guardians") {
      this.users.delete(this.key(organizationId, id));
    } else if (resource === "students") {
      this.students.delete(this.key(organizationId, id));
    }
  }

  async setStudentGuardians(
    organizationId: string,
    studentId: string,
    links: Array<{ guardianId: string; relationship: string; isPrimary: boolean }>,
  ): Promise<MasterDataItem> {
    const studentKey = this.masterKey(organizationId, "students", studentId);
    const student = this.masterData.get(studentKey);
    if (!student) throw new DomainError("MASTER_DATA_NOT_FOUND", "学生不存在", 404);
    if (new Set(links.map((link) => link.guardianId)).size !== links.length) {
      throw new DomainError("VALIDATION_ERROR", "监护人列表包含重复项", 400);
    }
    const guardians = links.map((link) => {
      const guardian = this.masterData.get(
        this.masterKey(organizationId, "guardians", link.guardianId),
      );
      if (!guardian) {
        throw new DomainError("GUARDIAN_NOT_FOUND", "监护人不存在或不属于当前机构", 404);
      }
      return {
        id: guardian.id,
        name: guardian.name,
        phone: guardian.phone ?? null,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
      };
    });
    for (const value of [...this.guardians]) {
      if (value.startsWith(`${organizationId}:`) && value.endsWith(`:${studentId}`)) {
        this.guardians.delete(value);
      }
    }
    links.forEach((link) =>
      this.guardians.add(this.guardianKey(organizationId, link.guardianId, studentId)),
    );
    const updated = { ...student, guardians, updatedAt: new Date() };
    this.masterData.set(studentKey, updated);
    return this.cleanMaster(updated);
  }

  async listCoursePackages(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<CoursePackageListItem>> {
    let items = [...this.coursePackages.values()]
      .filter((item) => item.organizationId === organizationId)
      .map((item) => this.coursePackageListItem(organizationId, item));
    if (query.courseId) items = items.filter((item) => item.courseId === query.courseId);
    if (query.status) items = items.filter((item) => item.status === query.status);
    if (query.keyword) {
      const keyword = query.keyword.toLocaleLowerCase();
      items = items.filter((item) =>
        [item.name, item.courseName, item.description]
          .some((value) => value?.toLocaleLowerCase().includes(keyword)),
      );
    }
    items.sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    );
    return this.page(items, query);
  }

  async getCoursePackage(
    organizationId: string,
    id: string,
  ): Promise<CoursePackageListItem | undefined> {
    const item = this.coursePackages.get(this.key(organizationId, id));
    return item ? this.coursePackageListItem(organizationId, item) : undefined;
  }

  async saveCoursePackage(
    organizationId: string,
    item: CoursePackage,
    expectedVersion?: number,
  ): Promise<boolean> {
    const duplicate = [...this.coursePackages.values()].some(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id !== item.id &&
        candidate.name === item.name,
    );
    if (duplicate) throw new DomainError("COURSE_PACKAGE_DUPLICATE", "课包名称已存在", 409);
    const key = this.key(organizationId, item.id);
    const current = this.coursePackages.get(key);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) {
      return false;
    }
    if (expectedVersion === undefined && current) {
      return false;
    }
    this.coursePackages.set(
      key,
      structuredClone({ ...item, organizationId }),
    );
    return true;
  }

  async findCoursePurchaseByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<CoursePurchaseListItem | undefined> {
    const item = [...this.coursePurchases.values()].find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.idempotencyKey === idempotencyKey,
    );
    if (!item) return undefined;
    const result = this.coursePurchaseListItem(organizationId, item);
    return result.entitlementId ? result : undefined;
  }

  async listCoursePurchases(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<CoursePurchaseListItem>> {
    let items = [...this.coursePurchases.values()]
      .filter((item) => item.organizationId === organizationId)
      .map((item) => this.coursePurchaseListItem(organizationId, item))
      .filter((item) => item.entitlementId !== "");
    if (query.studentId) items = items.filter((item) => item.studentId === query.studentId);
    if (query.courseId) items = items.filter((item) => item.courseId === query.courseId);
    if (query.status) items = items.filter((item) => item.status === query.status);
    if (query.keyword) {
      const keyword = query.keyword.toLocaleLowerCase();
      items = items.filter((item) =>
        [item.studentName, item.packageNameSnapshot, item.courseNameSnapshot]
          .some((value) => value.toLocaleLowerCase().includes(keyword)),
      );
    }
    items.sort(
      (left, right) =>
        right.purchasedAt.getTime() - left.purchasedAt.getTime() ||
        right.id.localeCompare(left.id),
    );
    return this.page(items, query);
  }

  async saveCoursePurchase(organizationId: string, item: CoursePurchase): Promise<void> {
    const duplicate = [...this.coursePurchases.values()].some(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.idempotencyKey === item.idempotencyKey &&
        candidate.id !== item.id,
    );
    if (duplicate) {
      throw new DomainError("IDEMPOTENCY_KEY_CONFLICT", "幂等键已用于其他购买请求", 409);
    }
    this.coursePurchases.set(
      this.key(organizationId, item.id),
      structuredClone({ ...item, organizationId }),
    );
  }

  async listStudentEntitlements(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<EntitlementListItem>> {
    let items = [...this.studentEntitlements.values()]
      .filter((item) => item.organizationId === organizationId)
      .map((item) => this.entitlementListItem(organizationId, item));
    if (query.studentId) items = items.filter((item) => item.studentId === query.studentId);
    if (query.courseId) items = items.filter((item) => item.courseId === query.courseId);
    if (query.status) items = items.filter((item) => item.status === query.status);
    if (query.keyword) {
      const keyword = query.keyword.toLocaleLowerCase();
      items = items.filter((item) =>
        [item.studentName, item.packageName, item.courseName]
          .some((value) => value.toLocaleLowerCase().includes(keyword)),
      );
    }
    items.sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    );
    return this.page(items, query);
  }

  async getStudentEntitlement(
    organizationId: string,
    id: string,
  ): Promise<EntitlementListItem | undefined> {
    const item = this.studentEntitlements.get(this.key(organizationId, id));
    return item ? this.entitlementListItem(organizationId, item) : undefined;
  }

  async saveStudentEntitlement(
    organizationId: string,
    item: StudentCourseEntitlement,
    expectedVersion?: number,
  ): Promise<boolean> {
    const key = this.key(organizationId, item.id);
    const current = this.studentEntitlements.get(key);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) return false;
    if (expectedVersion === undefined && current) return false;
    this.studentEntitlements.set(
      key,
      structuredClone({ ...item, organizationId }),
    );
    return true;
  }

  async listUsableStudentEntitlements(
    organizationId: string,
    studentId: string,
    courseId: string,
    businessDate: Date,
  ): Promise<StudentCourseEntitlement[]> {
    return [...this.studentEntitlements.values()]
      .filter(
        (item) =>
          item.organizationId === organizationId &&
          item.studentId === studentId &&
          item.courseId === courseId &&
          item.status === "ACTIVE" &&
          item.validFrom <= businessDate &&
          item.validUntil >= businessDate &&
          item.remainingCredits > item.reservedCredits,
      )
      .sort(
        (left, right) =>
          left.validUntil.getTime() - right.validUntil.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .map((item) => this.withoutTenant(item)!);
  }

  async getCoursePurchase(
    organizationId: string,
    id: string,
  ): Promise<CoursePurchase | undefined> {
    return this.withoutTenant(this.coursePurchases.get(this.key(organizationId, id)));
  }

  async getCreditReservationByBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<CreditReservation | undefined> {
    const item = [...this.creditReservations.values()].find(
      (candidate) =>
        candidate.organizationId === organizationId && candidate.bookingId === bookingId,
    );
    return this.withoutTenant(item);
  }

  async listExpiredCreditReservations(
    organizationId: string,
    expiresAt: Date,
    limit: number,
    excludedReservationIds: readonly string[] = [],
  ): Promise<CreditReservation[]> {
    const excludedIds = new Set(excludedReservationIds);
    return [...this.creditReservations.values()]
      .filter(
        (item) => {
          if (
            item.organizationId !== organizationId ||
            excludedIds.has(item.id) ||
            item.status !== "RESERVED" ||
            item.expiresAt === null ||
            item.expiresAt > expiresAt ||
            (item.nextSettlementAttemptAt !== null &&
              item.nextSettlementAttemptAt > expiresAt)
          ) {
            return false;
          }
          const booking = this.bookings.get(this.key(organizationId, item.bookingId));
          const session = booking
            ? this.sessions.get(this.key(organizationId, booking.sessionId))
            : undefined;
          return booking?.status === "CONFIRMED" && Boolean(session && session.endsAt <= expiresAt);
        },
      )
      .sort(
        (left, right) =>
          left.expiresAt!.getTime() - right.expiresAt!.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map((item) => this.withoutTenant(item)!);
  }

  async saveCreditReservation(
    organizationId: string,
    item: CreditReservation,
  ): Promise<void> {
    const key = this.key(organizationId, item.id);
    const current = this.creditReservations.get(key);
    this.creditReservations.set(
      key,
      structuredClone({
        ...item,
        entitlementId: current?.entitlementId ?? item.entitlementId,
        organizationId,
      }),
    );
  }

  async saveCreditReservationSettlementFailure(
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
  ): Promise<boolean> {
    const key = this.key(organizationId, item.id);
    const current = this.creditReservations.get(key);
    if (
      !current ||
      current.status !== "RESERVED" ||
      current.settlementAttemptCount !== expectedAttemptCount
    ) {
      return false;
    }
    this.creditReservations.set(key, structuredClone({ ...current, ...item, organizationId }));
    return true;
  }

  async expireStudentEntitlements(
    organizationId: string,
    businessDate: Date,
    updatedAt: Date,
  ): Promise<void> {
    for (const [key, item] of this.studentEntitlements) {
      if (
        item.organizationId === organizationId &&
        item.status === "ACTIVE" &&
        item.validUntil < businessDate
      ) {
        this.studentEntitlements.set(key, {
          ...item,
          status: "EXPIRED",
          version: item.version + 1,
          updatedAt,
        });
      }
    }
  }

  async listCreditLedgers(
    organizationId: string,
    entitlementId: string,
  ): Promise<CreditLedger[]> {
    return this.creditLedgerItems(organizationId, entitlementId);
  }

  async listCreditLedgerPage(
    organizationId: string,
    entitlementId: string,
    query: PageQuery,
  ): Promise<Page<CreditLedger>> {
    const keyword = query.keyword?.trim().toLocaleLowerCase();
    const matchingTypes = keyword ? creditLedgerTypesMatchingKeyword(keyword) : [];
    const items = this.creditLedgerItems(organizationId, entitlementId).filter(
      (item) =>
        !keyword ||
        matchingTypes.includes(item.type) ||
        item.note?.toLocaleLowerCase().includes(keyword) ||
        item.actorId.toLocaleLowerCase().includes(keyword),
    );
    return this.page(items, query);
  }

  private creditLedgerItems(
    organizationId: string,
    entitlementId: string,
  ): CreditLedger[] {
    return [...this.creditLedgers.values()]
      .filter(
        (item) =>
          item.organizationId === organizationId && item.entitlementId === entitlementId,
      )
      .sort(
        (left, right) =>
          right.occurredAt.getTime() - left.occurredAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .map((item) => this.withoutTenant(item)!);
  }

  async listBookingCreditLedgers(
    organizationId: string,
    bookingId: string,
  ): Promise<CreditLedger[]> {
    return [...this.creditLedgers.values()]
      .filter(
        (item) => item.organizationId === organizationId && item.bookingId === bookingId,
      )
      .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .map((item) => this.withoutTenant(item)!);
  }

  async saveCreditLedger(organizationId: string, item: CreditLedger): Promise<void> {
    const duplicate = [...this.creditLedgers.values()].some(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.idempotencyKey === item.idempotencyKey,
    );
    if (duplicate) {
      throw new DomainError("LEDGER_IDEMPOTENCY_CONFLICT", "流水幂等键已存在", 409);
    }
    this.creditLedgers.set(
      this.key(organizationId, item.id),
      structuredClone({ ...item, organizationId }),
    );
  }

  async listEntitlementValidityChanges(
    organizationId: string,
    entitlementId: string,
    query: PageQuery,
  ): Promise<Page<EntitlementValidityChange>> {
    const keyword = query.keyword?.trim().toLocaleLowerCase();
    const items = [...this.entitlementValidityChanges.values()]
      .filter(
        (item) =>
          item.organizationId === organizationId &&
          item.entitlementId === entitlementId &&
          (!keyword || item.reason.toLocaleLowerCase().includes(keyword)),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .map((item) => this.withoutTenant(item)!);
    return this.page(items, query);
  }

  async saveEntitlementValidityChange(
    organizationId: string,
    item: EntitlementValidityChange,
  ): Promise<void> {
    this.entitlementValidityChanges.set(
      this.key(organizationId, item.id),
      structuredClone({ ...item, organizationId }),
    );
  }

  async listSessions(
    organizationId: string,
    filter: SessionFilter,
  ): Promise<CourseSession[]> {
    return [...this.sessions.values()]
      .filter((session) => {
        if ((session.organizationId ?? "org-development") !== organizationId) return false;
        if (filter.from && session.endsAt <= filter.from) return false;
        if (filter.to && session.startsAt >= filter.to) return false;
        if (filter.teacherId && session.teacherId !== filter.teacherId) return false;
        if (filter.campusId && session.campusId !== filter.campusId) return false;
        if (filter.courseId && session.courseId !== filter.courseId) return false;
        if (filter.status && session.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((item) => this.withoutTenant(item)!);
  }

  async getSession(
    organizationId: string,
    id: string,
  ): Promise<CourseSession | undefined> {
    return this.withoutTenant(this.sessions.get(this.key(organizationId, id)));
  }

  async saveSession(organizationId: string, session: CourseSession): Promise<void> {
    this.sessions.set(
      this.key(organizationId, session.id),
      structuredClone({ ...session, organizationId }),
    );
    for (const [key, reservation] of this.creditReservations) {
      if (reservation.organizationId !== organizationId || reservation.status !== "RESERVED") {
        continue;
      }
      const booking = this.bookings.get(this.key(organizationId, reservation.bookingId));
      if (booking?.sessionId !== session.id) continue;
      this.creditReservations.set(key, {
        ...reservation,
        expiresAt: session.endsAt,
      });
    }
  }

  async getSeries(
    organizationId: string,
    id: string,
  ): Promise<ScheduleSeries | undefined> {
    return this.withoutTenant(this.series.get(this.key(organizationId, id)));
  }

  async saveSeries(organizationId: string, series: ScheduleSeries): Promise<void> {
    this.series.set(
      this.key(organizationId, series.id),
      structuredClone({ ...series, organizationId }),
    );
  }

  async listSeriesSessions(
    organizationId: string,
    seriesId: string,
  ): Promise<CourseSession[]> {
    return [...this.sessions.values()]
      .filter(
        (item) =>
          (item.organizationId ?? "org-development") === organizationId &&
          item.seriesId === seriesId,
      )
      .sort((a, b) => (a.occurrenceIndex ?? 0) - (b.occurrenceIndex ?? 0))
      .map((item) => this.withoutTenant(item)!);
  }

  async getStudent(organizationId: string, id: string): Promise<Student | undefined> {
    return this.withoutTenant(this.students.get(this.key(organizationId, id)));
  }

  async listBookings(organizationId: string): Promise<Booking[]> {
    return [...this.bookings.values()]
      .filter((item) => (item.organizationId ?? "org-development") === organizationId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      )
      .map((item) => this.withoutTenant(item)!);
  }

  async listAdminBookings(
    organizationId: string,
    filter: AdminBookingFilter,
  ): Promise<AdminBookingPage> {
    const items = [...this.bookings.values()]
      .filter((booking) => {
        if ((booking.organizationId ?? "org-development") !== organizationId) return false;
        if (filter.sessionId && booking.sessionId !== filter.sessionId) return false;
        if (filter.studentId && booking.studentId !== filter.studentId) return false;
        if (filter.status && booking.status !== filter.status) return false;
        const session = this.sessions.get(this.key(organizationId, booking.sessionId));
        if (!session) return false;
        if (filter.from && session.startsAt < filter.from) return false;
        if (filter.to && session.startsAt >= filter.to) return false;
        return true;
      })
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          b.id.localeCompare(a.id),
      )
      .flatMap((booking) => {
        const session = this.sessions.get(this.key(organizationId, booking.sessionId));
        const student = this.students.get(this.key(organizationId, booking.studentId));
        if (!session || !student) return [];
        return [{
          ...this.withoutTenant(booking)!,
          session: {
            id: session.id,
            courseId: session.courseId,
            courseName: session.courseName,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            status: session.status,
          },
          student: this.withoutTenant(student)!,
          teacher: {
            id: session.teacherId,
            name: session.teacherName,
          },
        }];
      });
    const start = (filter.page - 1) * filter.pageSize;
    return {
      items: items.slice(start, start + filter.pageSize),
      page: filter.page,
      pageSize: filter.pageSize,
      total: items.length,
    };
  }

  async getBooking(organizationId: string, id: string): Promise<Booking | undefined> {
    return this.withoutTenant(this.bookings.get(this.key(organizationId, id)));
  }

  async findBooking(
    organizationId: string,
    sessionId: string,
    studentId: string,
  ): Promise<Booking | undefined> {
    const item = [...this.bookings.values()].find(
      (booking) =>
        (booking.organizationId ?? "org-development") === organizationId &&
        booking.sessionId === sessionId && booking.studentId === studentId,
    );
    return this.withoutTenant(item);
  }

  async saveBooking(organizationId: string, booking: Booking): Promise<void> {
    this.bookings.set(
      this.key(organizationId, booking.id),
      structuredClone({ ...booking, organizationId }),
    );
  }

  async listGuardianIdsByStudentIds(
    organizationId: string,
    studentIds: string[],
  ): Promise<string[]> {
    const wanted = new Set(studentIds);
    const guardianIds = [...this.guardians]
      .filter((value) => value.startsWith(`${organizationId}:`))
      .map((value) => {
        const [, guardianId, studentId] = value.split(":");
        return studentId && wanted.has(studentId) ? guardianId : undefined;
      })
      .filter((id): id is string => id !== undefined);
    return [...new Set(guardianIds)];
  }

  async saveNotification(
    organizationId: string,
    notification: Notification,
  ): Promise<void> {
    this.notifications.set(
      this.key(organizationId, notification.id),
      structuredClone({ ...notification, organizationId }),
    );
  }

  async saveNotificationWithDelivery(
    organizationId: string,
    notification: Notification,
    delivery: NotificationDelivery,
  ): Promise<boolean> {
    const duplicate = [...this.notificationDeliveries.values()].some(
      (item) =>
        item.organizationId === organizationId &&
        item.idempotencyKey === delivery.idempotencyKey,
    );
    if (duplicate) return false;
    this.notifications.set(
      this.key(organizationId, notification.id),
      structuredClone({ ...notification, organizationId }),
    );
    this.notificationDeliveries.set(
      this.key(organizationId, delivery.id),
      structuredClone({ ...delivery, organizationId }),
    );
    return true;
  }

  async listNotifications(
    organizationId: string,
    userId: string,
    unreadOnly = false,
  ): Promise<Notification[]> {
    return [...this.notifications.values()]
      .filter(
        (item) =>
          (item.organizationId ?? "org-development") === organizationId &&
          item.userId === userId &&
          (!unreadOnly || item.readAt === null),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((item) => this.withoutTenant(item)!);
  }

  async getNotification(
    organizationId: string,
    id: string,
  ): Promise<Notification | undefined> {
    return this.withoutTenant(this.notifications.get(this.key(organizationId, id)));
  }

  async getUserWechatOpenId(
    organizationId: string,
    userId: string,
  ): Promise<string | null> {
    return this.users.get(this.key(organizationId, userId))?.wechatOpenId ?? null;
  }

  async listDueNotificationDeliveries(
    now: Date,
    limit: number,
  ): Promise<Array<NotificationDelivery & { organizationId: string }>> {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    return [...this.notificationDeliveries.values()]
      .filter(
        (item) =>
          ((item.status === "PENDING" || item.status === "FAILED") &&
            item.nextAttemptAt <= now) ||
          (item.status === "SENDING" && item.updatedAt <= staleBefore),
      )
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit)
      .map((item) => structuredClone({
        ...item,
        organizationId: item.organizationId ?? "org-development",
      }));
  }

  async claimNotificationDelivery(
    id: string,
    now: Date,
  ): Promise<NotificationDelivery | undefined> {
    const entry = [...this.notificationDeliveries.entries()].find(([, item]) => item.id === id);
    if (!entry) return undefined;
    const [key, item] = entry;
    const staleSending =
      item.status === "SENDING" &&
      item.updatedAt <= new Date(now.getTime() - 5 * 60_000);
    if (
      (!["PENDING", "FAILED"].includes(item.status) || item.nextAttemptAt > now) &&
      !staleSending
    ) {
      return undefined;
    }
    const claimed = { ...item, status: "SENDING" as const, updatedAt: now };
    this.notificationDeliveries.set(key, claimed);
    return this.withoutTenant(claimed);
  }

  async saveNotificationDelivery(
    organizationId: string,
    delivery: NotificationDelivery,
  ): Promise<void> {
    this.notificationDeliveries.set(
      this.key(organizationId, delivery.id),
      structuredClone({ ...delivery, organizationId }),
    );
  }

  async getNotificationDelivery(
    organizationId: string,
    id: string,
  ): Promise<NotificationDelivery | undefined> {
    return this.withoutTenant(
      this.notificationDeliveries.get(this.key(organizationId, id)),
    );
  }

  async listAdminNotificationDeliveries(
    organizationId: string,
    limit: number,
  ): Promise<AdminNotificationDelivery[]> {
    return [...this.notificationDeliveries.values()]
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .flatMap((item) => {
        const notification = this.notifications.get(
          this.key(organizationId, item.notificationId),
        );
        const user = this.users.get(this.key(organizationId, item.userId));
        if (!notification || !user) return [];
        return [{
          ...this.withoutTenant(item)!,
          notification: {
            title: notification.title,
            content: notification.content,
            type: notification.type,
            createdAt: notification.createdAt,
          },
          user: {
            id: user.id,
            name: user.name,
            wechatOpenId: user.wechatOpenId,
          },
        }];
      });
  }

  async saveAuditLog(organizationId: string, auditLog: AuditLog): Promise<void> {
    this.auditLogs.set(
      this.key(organizationId, auditLog.id),
      structuredClone({ ...auditLog, organizationId }),
    );
  }

  async listAuditLogs(organizationId: string): Promise<AuditLog[]> {
    return [...this.auditLogs.values()]
      .filter((item) => (item.organizationId ?? "org-development") === organizationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((item) => this.withoutTenant(item)!);
  }

  async withSessionLock<T>(
    organizationId: string,
    sessionId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const lockKey = this.key(organizationId, sessionId);
    const previous = this.lockTails.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.lockTails.set(lockKey, queued);

    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.lockTails.get(lockKey) === queued) {
        this.lockTails.delete(lockKey);
      }
    }
  }

  async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.transactions.getStore()) return action();
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshots = {
      organizations: structuredClone(this.organizations),
      organizationRecords: structuredClone(this.organizationRecords),
      users: structuredClone(this.users),
      authSessions: structuredClone(this.authSessions),
      platformAccounts: structuredClone(this.platformAccounts),
      platformSessions: structuredClone(this.platformSessions),
      platformAudits: structuredClone(this.platformAudits),
      tenantAdminEmails: structuredClone(this.tenantAdminEmails),
      guardians: structuredClone(this.guardians),
      sessions: structuredClone(this.sessions),
      students: structuredClone(this.students),
      series: structuredClone(this.series),
      bookings: structuredClone(this.bookings),
      notifications: structuredClone(this.notifications),
      notificationDeliveries: structuredClone(this.notificationDeliveries),
      auditLogs: structuredClone(this.auditLogs),
      masterData: structuredClone(this.masterData),
      coursePackages: structuredClone(this.coursePackages),
      coursePurchases: structuredClone(this.coursePurchases),
      studentEntitlements: structuredClone(this.studentEntitlements),
      creditLedgers: structuredClone(this.creditLedgers),
      creditReservations: structuredClone(this.creditReservations),
      entitlementValidityChanges: structuredClone(this.entitlementValidityChanges),
    };
    try {
      return await this.transactions.run(true, action);
    } catch (error) {
      this.restoreMap(this.organizations, snapshots.organizations);
      this.restoreMap(this.organizationRecords, snapshots.organizationRecords);
      this.restoreMap(this.users, snapshots.users);
      this.restoreMap(this.authSessions, snapshots.authSessions);
      this.restoreMap(this.platformAccounts, snapshots.platformAccounts);
      this.restoreMap(this.platformSessions, snapshots.platformSessions);
      this.restoreMap(this.platformAudits, snapshots.platformAudits);
      this.restoreMap(this.tenantAdminEmails, snapshots.tenantAdminEmails);
      this.restoreSet(this.guardians, snapshots.guardians);
      this.restoreMap(this.sessions, snapshots.sessions);
      this.restoreMap(this.students, snapshots.students);
      this.restoreMap(this.series, snapshots.series);
      this.restoreMap(this.bookings, snapshots.bookings);
      this.restoreMap(this.notifications, snapshots.notifications);
      this.restoreMap(this.notificationDeliveries, snapshots.notificationDeliveries);
      this.restoreMap(this.auditLogs, snapshots.auditLogs);
      this.restoreMap(this.masterData, snapshots.masterData);
      this.restoreMap(this.coursePackages, snapshots.coursePackages);
      this.restoreMap(this.coursePurchases, snapshots.coursePurchases);
      this.restoreMap(this.studentEntitlements, snapshots.studentEntitlements);
      this.restoreMap(this.creditLedgers, snapshots.creditLedgers);
      this.restoreMap(this.creditReservations, snapshots.creditReservations);
      this.restoreMap(
        this.entitlementValidityChanges,
        snapshots.entitlementValidityChanges,
      );
      throw error;
    } finally {
      release();
    }
  }

  private key(organizationId: string | undefined, id: string): string {
    return `${organizationId ?? "org-development"}:${id}`;
  }

  private page<T>(items: T[], query: PageQuery): Page<T> {
    const start = coursePackagePageOffset(query);
    return {
      items: start >= items.length ? [] : items.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: items.length,
    };
  }

  private coursePackageListItem(
    organizationId: string,
    item: TenantItem<CoursePackage>,
  ): CoursePackageListItem {
    const course = this.masterData.get(
      this.masterKey(organizationId, "courses", item.courseId),
    );
    const soldCount = [...this.coursePurchases.values()].filter(
      (purchase) =>
        purchase.organizationId === organizationId &&
        purchase.packageId === item.id &&
        purchase.status === "PAID",
    ).length;
    return {
      ...this.withoutTenant(item)!,
      courseName: course?.name ?? "",
      soldCount,
    };
  }

  private coursePurchaseListItem(
    organizationId: string,
    item: TenantItem<CoursePurchase>,
  ): CoursePurchaseListItem {
    const student = this.masterData.get(
      this.masterKey(organizationId, "students", item.studentId),
    );
    const entitlement = [...this.studentEntitlements.values()].find(
      (candidate) =>
        candidate.organizationId === organizationId && candidate.purchaseId === item.id,
    );
    return {
      ...this.withoutTenant(item)!,
      studentName: student?.name ?? "",
      entitlementId: entitlement?.id ?? "",
    };
  }

  private entitlementListItem(
    organizationId: string,
    item: TenantItem<StudentCourseEntitlement>,
  ): EntitlementListItem {
    const student = this.masterData.get(
      this.masterKey(organizationId, "students", item.studentId),
    );
    const purchase = this.coursePurchases.get(this.key(organizationId, item.purchaseId));
    return {
      ...this.withoutTenant(item)!,
      studentName: student?.name ?? "",
      packageName: purchase?.packageNameSnapshot ?? "",
      courseName: purchase?.courseNameSnapshot ?? "",
    };
  }

  private guardianKey(organizationId: string, guardianId: string, studentId: string): string {
    return `${organizationId}:${guardianId}:${studentId}`;
  }

  private masterKey(
    organizationId: string,
    resource: MasterResource,
    id: string,
  ): string {
    return `${organizationId}:${resource}:${id}`;
  }

  private saveMasterSeed(
    resource: MasterResource,
    item: TenantItem<MasterDataItem>,
  ): void {
    const organizationId = item.organizationId ?? "org-development";
    this.masterData.set(this.masterKey(organizationId, resource, item.id), {
      ...structuredClone(item),
      organizationId,
      resource,
    });
  }

  private cleanMaster(
    item: TenantItem<MasterDataItem> & { resource: MasterResource },
  ): MasterDataItem {
    const cloned = structuredClone(item);
    const { organizationId: _organizationId, resource: _resource, ...result } = cloned;
    return result;
  }

  private async validateMasterReferences(
    organizationId: string,
    resource: MasterResource,
    input: Record<string, unknown>,
  ): Promise<void> {
    if ((resource === "classrooms" || resource === "students") && input.campusId) {
      if (!this.masterData.has(this.masterKey(organizationId, "campuses", String(input.campusId)))) {
        throw new DomainError("CAMPUS_NOT_FOUND", "所属校区不存在", 404);
      }
    }
  }

  private ensureMasterUnique(
    organizationId: string,
    resource: MasterResource,
    input: Record<string, unknown>,
    excludedId?: string,
  ): void {
    const duplicated = [...this.masterData.values()].some(
      (item) => {
        if (item.organizationId !== organizationId || item.id === excludedId) return false;
        if (resource === "campuses") {
          return item.resource === resource && item.name === input.name;
        }
        if (resource === "classrooms") {
          return (
            item.resource === resource &&
            item.campusId === input.campusId &&
            (item.name === input.name || Boolean(input.code && item.code === input.code))
          );
        }
        if (resource === "courses") {
          return (
            item.resource === resource &&
            (item.name === input.name || Boolean(input.code && item.code === input.code))
          );
        }
        if (resource === "teachers" || resource === "guardians") {
          return (
            (item.resource === "teachers" || item.resource === "guardians") &&
            Boolean(input.phone && item.phone === input.phone)
          );
        }
        return false;
      },
    );
    if (duplicated) {
      throw new DomainError("MASTER_DATA_DUPLICATE", "同一机构内已存在相同名称、编码或联系方式", 409);
    }
  }

  private syncMaster(
    resource: MasterResource,
    item: TenantItem<MasterDataItem> & { resource: MasterResource },
  ): void {
    const organizationId = item.organizationId ?? "org-development";
    if (resource === "teachers" || resource === "guardians") {
      const current = this.users.get(this.key(organizationId, item.id));
      this.users.set(this.key(organizationId, item.id), {
        id: item.id,
        organizationId,
        role: resource === "teachers" ? "TEACHER" : "GUARDIAN",
        name: item.name,
        phone: item.phone ?? null,
        passwordHash: current?.passwordHash ?? null,
        wechatOpenId: current?.wechatOpenId ?? null,
        isActive: item.isActive,
        mustChangePassword: current?.mustChangePassword ?? false,
      });
    } else if (resource === "students") {
      this.students.set(this.key(organizationId, item.id), {
        organizationId,
        id: item.id,
        name: item.name,
        guardianPhone: item.guardians?.find((link) => link.isPrimary)?.phone ??
          item.guardians?.[0]?.phone ?? "",
      });
    }
  }

  private withoutTenant<T>(
    item: TenantItem<T> | undefined,
  ): T | undefined {
    if (!item) return undefined;
    const cloned = structuredClone(item);
    delete cloned.organizationId;
    return cloned;
  }

  private restoreMap<K, V>(target: Map<K, V>, snapshot: Map<K, V>): void {
    target.clear();
    snapshot.forEach((value, key) => target.set(key, value));
  }

  private restoreSet<T>(target: Set<T>, snapshot: Set<T>): void {
    target.clear();
    snapshot.forEach((value) => target.add(value));
  }

  private saveOrganization(input: {
    id: string;
    code: string;
    name: string;
  }): PlatformOrganization {
    const now = new Date();
    const organization: PlatformOrganization = {
      ...input,
      isActive: true,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.organizationRecords.set(input.id, organization);
    this.organizations.set(input.id, input.code);
    return structuredClone(organization);
  }

  private requireOrganization(id: string): PlatformOrganization {
    const organization = this.organizationRecords.get(id);
    if (!organization || organization.deletedAt) {
      throw new DomainError("ORGANIZATION_NOT_FOUND", "机构不存在或已删除", 404);
    }
    return organization;
  }

  private toTenantAdmin(user: AuthUser): PlatformTenantAdmin {
    const now = new Date();
    return {
      id: user.id,
      organizationId: user.organizationId,
      name: user.name,
      phone: user.phone,
      email: this.tenantAdminEmails.get(this.key(user.organizationId, user.id)) ?? null,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
