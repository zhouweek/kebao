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
  MasterDataItem,
  MasterDataPage,
  MasterDataQuery,
  MasterResource,
} from "./master-data.js";

type TenantItem<T> = T & { organizationId?: string };

export interface MemorySeed {
  organizations?: Array<string | { id: string; code: string }>;
  users?: Array<
    UserIdentity &
      Partial<Pick<AuthUser, "name" | "phone" | "passwordHash" | "wechatOpenId" | "isActive">>
  >;
  authSessions?: AuthSession[];
  guardians?: Array<{ organizationId: string; guardianId: string; studentId: string }>;
  sessions?: Array<TenantItem<CourseSession>>;
  students?: Array<TenantItem<Student>>;
  bookings?: Array<TenantItem<Booking>>;
  notifications?: Array<TenantItem<Notification>>;
  notificationDeliveries?: Array<TenantItem<NotificationDelivery>>;
  auditLogs?: Array<TenantItem<AuditLog>>;
  series?: Array<TenantItem<ScheduleSeries>>;
  masterData?: Partial<Record<MasterResource, Array<TenantItem<MasterDataItem>>>>;
}

/**
 * 本仓储只用于本地开发和测试。
 * `withSessionLock` 将同一课次的预约串行化，模拟数据库事务中的行锁。
 */
export class MemoryRepository implements Repository {
  private readonly organizations = new Map<string, string>();
  private readonly users = new Map<string, AuthUser>();
  private readonly authSessions = new Map<string, AuthSession>();
  private readonly guardians = new Set<string>();
  private readonly sessions = new Map<string, TenantItem<CourseSession>>();
  private readonly students = new Map<string, TenantItem<Student>>();
  private readonly bookings = new Map<string, TenantItem<Booking>>();
  private readonly notifications = new Map<string, TenantItem<Notification>>();
  private readonly notificationDeliveries = new Map<string, TenantItem<NotificationDelivery>>();
  private readonly auditLogs = new Map<string, TenantItem<AuditLog>>();
  private readonly series = new Map<string, TenantItem<ScheduleSeries>>();
  private readonly masterData = new Map<string, TenantItem<MasterDataItem> & { resource: MasterResource }>();
  private readonly lockTails = new Map<string, Promise<void>>();
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(seed: MemorySeed = {}) {
    this.organizations.set("org-development", "DEMO");
    seed.organizations?.forEach((organization) => {
      const item =
        typeof organization === "string"
          ? { id: organization, code: organization }
          : organization;
      this.organizations.set(item.id, item.code);
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
        }),
      );
    });
    seed.authSessions?.forEach((session) =>
      this.authSessions.set(session.id, structuredClone(session)),
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
    return this.organizations.has(organizationId);
  }

  async listOrganizationIds(): Promise<string[]> {
    return [...this.organizations.keys()];
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
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const session = this.authSessions.get(id);
    if (!session) return;
    this.authSessions.set(id, {
      ...session,
      refreshTokenHash,
      expiresAt,
    });
  }

  async revokeAuthSession(id: string): Promise<void> {
    const session = this.authSessions.get(id);
    if (!session) return;
    this.authSessions.set(id, { ...session, revokedAt: new Date() });
  }

  async touchUserLastLogin(
    _userId: string,
    _organizationId: string,
    _at: Date,
  ): Promise<void> {
    // 内存仓储不持久化展示字段，仅保持与数据库仓储一致的接口。
  }

  async isGuardianOfStudent(
    organizationId: string,
    guardianId: string,
    studentId: string,
  ): Promise<boolean> {
    return this.guardians.has(this.guardianKey(organizationId, guardianId, studentId));
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
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
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
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshots = {
      sessions: structuredClone(this.sessions),
      series: structuredClone(this.series),
      bookings: structuredClone(this.bookings),
      notifications: structuredClone(this.notifications),
      notificationDeliveries: structuredClone(this.notificationDeliveries),
      auditLogs: structuredClone(this.auditLogs),
    };
    try {
      return await action();
    } catch (error) {
      this.restoreMap(this.sessions, snapshots.sessions);
      this.restoreMap(this.series, snapshots.series);
      this.restoreMap(this.bookings, snapshots.bookings);
      this.restoreMap(this.notifications, snapshots.notifications);
      this.restoreMap(this.notificationDeliveries, snapshots.notificationDeliveries);
      this.restoreMap(this.auditLogs, snapshots.auditLogs);
      throw error;
    } finally {
      release();
    }
  }

  private key(organizationId: string | undefined, id: string): string {
    return `${organizationId ?? "org-development"}:${id}`;
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
}
