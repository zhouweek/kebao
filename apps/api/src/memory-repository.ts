import type {
  AuditLog,
  Booking,
  CourseSession,
  Notification,
  Repository,
  SessionFilter,
  Student,
  UserIdentity,
} from "./domain.js";

type TenantItem<T> = T & { organizationId?: string };

export interface MemorySeed {
  organizations?: string[];
  users?: UserIdentity[];
  guardians?: Array<{ organizationId: string; guardianId: string; studentId: string }>;
  sessions?: Array<TenantItem<CourseSession>>;
  students?: Array<TenantItem<Student>>;
  bookings?: Array<TenantItem<Booking>>;
  notifications?: Array<TenantItem<Notification>>;
  auditLogs?: Array<TenantItem<AuditLog>>;
}

/**
 * 本仓储只用于本地开发和测试。
 * `withSessionLock` 将同一课次的预约串行化，模拟数据库事务中的行锁。
 */
export class MemoryRepository implements Repository {
  private readonly organizations = new Set<string>();
  private readonly users = new Map<string, UserIdentity>();
  private readonly guardians = new Set<string>();
  private readonly sessions = new Map<string, TenantItem<CourseSession>>();
  private readonly students = new Map<string, TenantItem<Student>>();
  private readonly bookings = new Map<string, TenantItem<Booking>>();
  private readonly notifications = new Map<string, TenantItem<Notification>>();
  private readonly auditLogs = new Map<string, TenantItem<AuditLog>>();
  private readonly lockTails = new Map<string, Promise<void>>();

  constructor(seed: MemorySeed = {}) {
    this.organizations.add("org-development");
    seed.organizations?.forEach((id) => this.organizations.add(id));
    seed.users?.forEach((user) => {
      this.organizations.add(user.organizationId);
      this.users.set(this.key(user.organizationId, user.id), structuredClone(user));
    });
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
    seed.auditLogs?.forEach((item) =>
      this.auditLogs.set(this.key(item.organizationId, item.id), structuredClone(item)),
    );
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.organizations.has(organizationId);
  }

  async getUserIdentity(
    organizationId: string,
    userId: string,
  ): Promise<UserIdentity | undefined> {
    return structuredClone(this.users.get(this.key(organizationId, userId)));
  }

  async isGuardianOfStudent(
    organizationId: string,
    guardianId: string,
    studentId: string,
  ): Promise<boolean> {
    return this.guardians.has(this.guardianKey(organizationId, guardianId, studentId));
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

  async getStudent(organizationId: string, id: string): Promise<Student | undefined> {
    return this.withoutTenant(this.students.get(this.key(organizationId, id)));
  }

  async listBookings(organizationId: string): Promise<Booking[]> {
    return [...this.bookings.values()]
      .filter((item) => (item.organizationId ?? "org-development") === organizationId)
      .map((item) => this.withoutTenant(item)!);
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

  private key(organizationId: string | undefined, id: string): string {
    return `${organizationId ?? "org-development"}:${id}`;
  }

  private guardianKey(organizationId: string, guardianId: string, studentId: string): string {
    return `${organizationId}:${guardianId}:${studentId}`;
  }

  private withoutTenant<T>(
    item: TenantItem<T> | undefined,
  ): T | undefined {
    if (!item) return undefined;
    const cloned = structuredClone(item);
    delete cloned.organizationId;
    return cloned;
  }
}
