import type { AuthRepository } from "./auth.js";
import type { PlatformRepository } from "./platform.js";
import type { MasterDataRepository } from "./master-data.js";

export type SessionStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "CLOSED"
  | "CANCELLED"
  | "FINISHED";

export type BookingStatus =
  | "CONFIRMED"
  | "CANCELLED"
  | "COURSE_CANCELLED"
  | "ATTENDED"
  | "LEAVE"
  | "ABSENT";

export type UserRole = "ADMIN" | "TEACHER" | "GUARDIAN";

export interface UserIdentity {
  id: string;
  organizationId: string;
  role: UserRole;
}

export interface CourseSession {
  id: string;
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  classroomId: string | null;
  classroomName: string | null;
  teacherId: string;
  teacherName: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: SessionStatus;
  bookingOpensAt: Date;
  bookingClosesAt: Date;
  cancelDeadlineAt: Date;
  seriesId?: string | null;
  occurrenceIndex?: number | null;
}

export interface ScheduleSeries {
  id: string;
  recurrence: "WEEKLY";
  intervalWeeks: number;
  requestedCount: number;
  createdBy: string;
  createdAt: Date;
}

export type SeriesOperationScope = "THIS" | "THIS_AND_FUTURE";

export interface SeriesConflict {
  date: string;
  startsAt: Date;
  endsAt: Date;
  conflicts: Array<{
    sessionId: string;
    teacherConflict: boolean;
    classroomConflict: boolean;
  }>;
}

export interface CreateSeriesInput extends CreateSessionInput {
  recurrence: "WEEKLY";
  intervalWeeks?: number;
  repeatCount: number;
  skipConflicts?: boolean;
}

export interface SeriesCreateResult {
  series: ScheduleSeries | null;
  sessions: CourseSession[];
  successDates: string[];
  conflicts: SeriesConflict[];
}

export interface Student {
  id: string;
  name: string;
  guardianPhone: string;
}

export interface GuardianStudent {
  id: string;
  name: string;
}

export interface Booking {
  id: string;
  sessionId: string;
  studentId: string;
  status: BookingStatus;
  createdAt: Date;
}

export interface AdminBookingListItem extends Booking {
  session: {
    id: string;
    courseId: string;
    courseName: string;
    startsAt: Date;
    endsAt: Date;
    status: SessionStatus;
  };
  student: Student;
  teacher: {
    id: string;
    name: string;
  };
}

export interface AdminBookingFilter {
  page: number;
  pageSize: number;
  sessionId?: string;
  studentId?: string;
  status?: BookingStatus;
  from?: Date;
  to?: Date;
}

export interface AdminBookingPage {
  items: AdminBookingListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export type AttendanceStatus = "ATTENDED" | "LEAVE" | "ABSENT";
export type NotificationType =
  | "SESSION_RESCHEDULED"
  | "SESSION_CANCELLED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "SESSION_REMINDER_24H"
  | "SESSION_REMINDER_2H";
export type NotificationDeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  sessionId: string | null;
  idempotencyKey?: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  userId: string;
  channel: "WECHAT";
  status: NotificationDeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  idempotencyKey: string;
  payload: {
    type: NotificationType;
    title: string;
    content: string;
    sessionId: string | null;
    page?: string;
  };
  nextAttemptAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminNotificationDelivery extends NotificationDelivery {
  notification: Pick<Notification, "title" | "content" | "type" | "createdAt">;
  user: { id: string; name: string; wechatOpenId: string | null };
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  createdAt: Date;
}

export interface RescheduleSessionInput {
  startsAt: Date;
  endsAt: Date;
  teacherId?: string;
  teacherName?: string;
  classroomId?: string | null;
  classroomName?: string | null;
}

export interface SessionListItem extends CourseSession {
  bookedCount: number;
  remainingCapacity: number;
}

export interface SessionFilter {
  from?: Date;
  to?: Date;
  teacherId?: string;
  campusId?: string;
  courseId?: string;
  status?: SessionStatus;
}

export interface CreateSessionInput {
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  classroomId?: string | null;
  classroomName?: string | null;
  teacherId: string;
  teacherName: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status?: SessionStatus;
  bookingOpensAt?: Date;
  bookingClosesAt?: Date;
  cancelDeadlineAt?: Date;
}

export interface Repository extends AuthRepository, PlatformRepository, MasterDataRepository {
  listOrganizationIds(): Promise<string[]>;
  organizationExists(organizationId: string): Promise<boolean>;
  getUserIdentity(organizationId: string, userId: string): Promise<UserIdentity | undefined>;
  isGuardianOfStudent(
    organizationId: string,
    guardianId: string,
    studentId: string,
  ): Promise<boolean>;
  listGuardianStudents(
    organizationId: string,
    guardianId: string,
  ): Promise<GuardianStudent[]>;
  listSessions(organizationId: string, filter: SessionFilter): Promise<CourseSession[]>;
  getSession(organizationId: string, id: string): Promise<CourseSession | undefined>;
  saveSession(organizationId: string, session: CourseSession): Promise<void>;
  getSeries(organizationId: string, id: string): Promise<ScheduleSeries | undefined>;
  saveSeries(organizationId: string, series: ScheduleSeries): Promise<void>;
  listSeriesSessions(organizationId: string, seriesId: string): Promise<CourseSession[]>;
  getStudent(organizationId: string, id: string): Promise<Student | undefined>;
  listBookings(organizationId: string): Promise<Booking[]>;
  listAdminBookings(
    organizationId: string,
    filter: AdminBookingFilter,
  ): Promise<AdminBookingPage>;
  getBooking(organizationId: string, id: string): Promise<Booking | undefined>;
  findBooking(
    organizationId: string,
    sessionId: string,
    studentId: string,
  ): Promise<Booking | undefined>;
  saveBooking(organizationId: string, booking: Booking): Promise<void>;
  listGuardianIdsByStudentIds(
    organizationId: string,
    studentIds: string[],
  ): Promise<string[]>;
  saveNotification(organizationId: string, notification: Notification): Promise<void>;
  saveNotificationWithDelivery(
    organizationId: string,
    notification: Notification,
    delivery: NotificationDelivery,
  ): Promise<boolean>;
  listNotifications(
    organizationId: string,
    userId: string,
    unreadOnly?: boolean,
  ): Promise<Notification[]>;
  getNotification(
    organizationId: string,
    id: string,
  ): Promise<Notification | undefined>;
  getUserWechatOpenId(organizationId: string, userId: string): Promise<string | null>;
  listDueNotificationDeliveries(now: Date, limit: number): Promise<Array<NotificationDelivery & { organizationId: string }>>;
  claimNotificationDelivery(id: string, now: Date): Promise<NotificationDelivery | undefined>;
  getNotificationDelivery(
    organizationId: string,
    id: string,
  ): Promise<NotificationDelivery | undefined>;
  saveNotificationDelivery(organizationId: string, delivery: NotificationDelivery): Promise<void>;
  listAdminNotificationDeliveries(
    organizationId: string,
    limit: number,
  ): Promise<AdminNotificationDelivery[]>;
  saveAuditLog(organizationId: string, auditLog: AuditLog): Promise<void>;
  listAuditLogs(organizationId: string): Promise<AuditLog[]>;
  withSessionLock<T>(
    organizationId: string,
    sessionId: string,
    action: () => Promise<T>,
  ): Promise<T>;
  withTransaction<T>(action: () => Promise<T>): Promise<T>;
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const OCCUPYING_STATUSES: SessionStatus[] = ["PUBLISHED", "CLOSED"];
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  "CONFIRMED",
  "ATTENDED",
  "LEAVE",
  "ABSENT",
];

const ATTENDANCE_STATUSES: AttendanceStatus[] = ["ATTENDED", "LEAVE", "ABSENT"];

function overlaps(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date,
): boolean {
  return firstStart < secondEnd && firstEnd > secondStart;
}

export class SchedulingService {
  constructor(
    private readonly repository: Repository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly organizationId = "org-development",
    private readonly actorId = "system",
  ) {}

  async listSessions(filter: SessionFilter): Promise<SessionListItem[]> {
    const [sessions, bookings] = await Promise.all([
      this.repository.listSessions(this.organizationId, filter),
      this.repository.listBookings(this.organizationId),
    ]);

    return sessions.map((session) => {
      const bookedCount = bookings.filter(
        (booking) =>
          booking.sessionId === session.id &&
          ACTIVE_BOOKING_STATUSES.includes(booking.status),
      ).length;
      return {
        ...session,
        bookedCount,
        remainingCapacity: Math.max(0, session.capacity - bookedCount),
      };
    });
  }

  async createSession(input: CreateSessionInput): Promise<CourseSession> {
    return this.createSessionRecord(input);
  }

  async previewSeries(input: CreateSeriesInput): Promise<SeriesCreateResult> {
    const candidates = this.expandSeries(input);
    const conflicts = await this.findSeriesConflicts(candidates);
    return {
      series: null,
      sessions: [],
      successDates: candidates
        .filter((candidate) => !conflicts.some((item) => item.startsAt.getTime() === candidate.startsAt.getTime()))
        .map((candidate) => this.dateKey(candidate.startsAt)),
      conflicts,
    };
  }

  async createSeries(input: CreateSeriesInput): Promise<SeriesCreateResult> {
    const candidates = this.expandSeries(input);
    return this.repository.withTransaction(async () => {
      // 在事务内再次执行完整预检，避免两个并发系列在预检后同时写入。
      const conflicts = await this.findSeriesConflicts(candidates);
      if (conflicts.length > 0 && !input.skipConflicts) {
        throw new DomainError("SERIES_CONFLICT", "排课系列存在冲突，未创建任何课次", 409, {
          conflicts,
        });
      }
      const blocked = new Set(conflicts.map((item) => item.startsAt.getTime()));
      const accepted = candidates.filter(
        (candidate) => !blocked.has(candidate.startsAt.getTime()),
      );
      const series: ScheduleSeries = {
        id: this.createId(),
        recurrence: "WEEKLY",
        intervalWeeks: input.intervalWeeks ?? 1,
        requestedCount: input.repeatCount,
        createdBy: this.actorId,
        createdAt: this.now(),
      };
      await this.repository.saveSeries(this.organizationId, series);
      const sessions: CourseSession[] = [];
      for (const candidate of accepted) {
        sessions.push(
          await this.createSessionRecord({
            ...candidate,
            seriesId: series.id,
            occurrenceIndex: candidate.occurrenceIndex,
          }),
        );
      }
      await this.audit("SESSION_SERIES_CREATED", "ScheduleSeries", series.id, {
        requestedCount: input.repeatCount,
        createdCount: sessions.length,
        conflictDates: conflicts.map((item) => item.date),
      });
      return {
        series,
        sessions,
        successDates: sessions.map((session) => this.dateKey(session.startsAt)),
        conflicts,
      };
    });
  }

  private async createSessionRecord(
    input: CreateSessionInput & { seriesId?: string; occurrenceIndex?: number },
  ): Promise<CourseSession> {
    if (input.endsAt <= input.startsAt) {
      throw new DomainError("INVALID_TIME_RANGE", "结束时间必须晚于开始时间", 400);
    }
    if (input.endsAt.getTime() - input.startsAt.getTime() > 8 * 60 * 60 * 1000) {
      throw new DomainError("SESSION_TOO_LONG", "单次课程最长为 8 小时", 400);
    }
    if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
      throw new DomainError("INVALID_CAPACITY", "课次容量必须为正整数", 400);
    }

    const status = input.status ?? "PUBLISHED";
    if (OCCUPYING_STATUSES.includes(status)) {
      const candidates = await this.repository.listSessions(this.organizationId, {
        from: input.startsAt,
        to: input.endsAt,
      });
      const conflicts = candidates.filter(
        (session) =>
          OCCUPYING_STATUSES.includes(session.status) &&
          overlaps(input.startsAt, input.endsAt, session.startsAt, session.endsAt) &&
          (session.teacherId === input.teacherId ||
            (input.classroomId !== null &&
              input.classroomId !== undefined &&
              session.classroomId === input.classroomId)),
      );
      if (conflicts.length > 0) {
        throw new DomainError("SESSION_CONFLICT", "老师或教室在该时段已被占用", 409, {
          conflicts: conflicts.map((session) => ({
            sessionId: session.id,
            teacherConflict: session.teacherId === input.teacherId,
            classroomConflict:
              input.classroomId !== null &&
              input.classroomId !== undefined &&
              session.classroomId === input.classroomId,
          })),
        });
      }
    }

    const session: CourseSession = {
      ...input,
      id: this.createId(),
      classroomId: input.classroomId ?? null,
      classroomName: input.classroomName ?? null,
      status,
      // 默认开课前 7 天开放、2 小时停止预约、4 小时停止自助取消。
      bookingOpensAt:
        input.bookingOpensAt ??
        new Date(input.startsAt.getTime() - 7 * 24 * 60 * 60 * 1000),
      bookingClosesAt:
        input.bookingClosesAt ??
        new Date(input.startsAt.getTime() - 2 * 60 * 60 * 1000),
      cancelDeadlineAt:
        input.cancelDeadlineAt ??
        new Date(input.startsAt.getTime() - 4 * 60 * 60 * 1000),
      seriesId: input.seriesId ?? null,
      occurrenceIndex: input.occurrenceIndex ?? null,
    };
    await this.repository.saveSession(this.organizationId, session);
    await this.audit("SESSION_CREATED", "CourseSession", session.id, {
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
    });
    return session;
  }

  private expandSeries(
    input: CreateSeriesInput,
  ): Array<CreateSessionInput & { occurrenceIndex: number }> {
    if (input.recurrence !== "WEEKLY") {
      throw new DomainError("INVALID_RECURRENCE", "目前仅支持按周重复", 400);
    }
    const intervalWeeks = input.intervalWeeks ?? 1;
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 52) {
      throw new DomainError("INVALID_INTERVAL", "重复间隔必须为 1 到 52 周", 400);
    }
    if (!Number.isInteger(input.repeatCount) || input.repeatCount < 1 || input.repeatCount > 104) {
      throw new DomainError("INVALID_REPEAT_COUNT", "重复次数必须为 1 到 104 次", 400);
    }
    const {
      recurrence: _recurrence,
      intervalWeeks: _intervalWeeks,
      repeatCount: _repeatCount,
      skipConflicts: _skipConflicts,
      ...base
    } = input;
    const step = intervalWeeks * 7 * 24 * 60 * 60 * 1000;
    return Array.from({ length: input.repeatCount }, (_, occurrenceIndex) => {
      const offset = occurrenceIndex * step;
      return {
        ...base,
        startsAt: new Date(input.startsAt.getTime() + offset),
        endsAt: new Date(input.endsAt.getTime() + offset),
        ...(input.bookingOpensAt
          ? { bookingOpensAt: new Date(input.bookingOpensAt.getTime() + offset) }
          : {}),
        ...(input.bookingClosesAt
          ? { bookingClosesAt: new Date(input.bookingClosesAt.getTime() + offset) }
          : {}),
        ...(input.cancelDeadlineAt
          ? { cancelDeadlineAt: new Date(input.cancelDeadlineAt.getTime() + offset) }
          : {}),
        occurrenceIndex,
      };
    });
  }

  private async findSeriesConflicts(
    candidates: Array<CreateSessionInput & { occurrenceIndex: number }>,
    excludedSessionIds: Set<string> = new Set(),
  ): Promise<SeriesConflict[]> {
    const conflicts: SeriesConflict[] = [];
    for (const candidate of candidates) {
      if (!OCCUPYING_STATUSES.includes(candidate.status ?? "PUBLISHED")) continue;
      const existing = await this.repository.listSessions(this.organizationId, {
        from: candidate.startsAt,
        to: candidate.endsAt,
      });
      const matches = existing
        .filter(
          (session) =>
            !excludedSessionIds.has(session.id) &&
            OCCUPYING_STATUSES.includes(session.status) &&
            overlaps(candidate.startsAt, candidate.endsAt, session.startsAt, session.endsAt) &&
            (session.teacherId === candidate.teacherId ||
              (candidate.classroomId != null && session.classroomId === candidate.classroomId)),
        )
        .map((session) => ({
          sessionId: session.id,
          teacherConflict: session.teacherId === candidate.teacherId,
          classroomConflict:
            candidate.classroomId != null && session.classroomId === candidate.classroomId,
        }));
      if (matches.length) {
        conflicts.push({
          date: this.dateKey(candidate.startsAt),
          startsAt: candidate.startsAt,
          endsAt: candidate.endsAt,
          conflicts: matches,
        });
      }
    }
    return conflicts;
  }

  private dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async rescheduleWithScope(
    sessionId: string,
    input: RescheduleSessionInput,
    scope: SeriesOperationScope,
  ): Promise<CourseSession[]> {
    if (scope === "THIS") return [await this.rescheduleSession(sessionId, input)];
    if (input.endsAt <= input.startsAt) {
      throw new DomainError("INVALID_TIME_RANGE", "结束时间必须晚于开始时间", 400);
    }
    if (input.endsAt.getTime() - input.startsAt.getTime() > 8 * 60 * 60 * 1000) {
      throw new DomainError("SESSION_TOO_LONG", "单次课程最长为 8 小时", 400);
    }
    const current = await this.requireSession(sessionId);
    if (!current.seriesId || current.occurrenceIndex == null) {
      throw new DomainError("SESSION_NOT_IN_SERIES", "当前课次不属于排课系列", 409);
    }
    const all = await this.repository.listSeriesSessions(this.organizationId, current.seriesId);
    const affected = all.filter(
      (item) =>
        item.occurrenceIndex != null &&
        item.occurrenceIndex >= current.occurrenceIndex! &&
        item.status !== "CANCELLED" &&
        item.status !== "FINISHED",
    );
    const startDelta = input.startsAt.getTime() - current.startsAt.getTime();
    const endDelta = input.endsAt.getTime() - current.endsAt.getTime();
    const candidates = affected.map((item) => ({
      ...item,
      startsAt: new Date(item.startsAt.getTime() + startDelta),
      endsAt: new Date(item.endsAt.getTime() + endDelta),
      teacherId: input.teacherId ?? item.teacherId,
      teacherName: input.teacherName ?? item.teacherName,
      classroomId: input.classroomId === undefined ? item.classroomId : input.classroomId,
      classroomName:
        input.classroomName === undefined ? item.classroomName : input.classroomName,
      occurrenceIndex: item.occurrenceIndex!,
    }));
    const conflicts = await this.findSeriesConflicts(
      candidates,
      new Set(affected.map((item) => item.id)),
    );
    if (conflicts.length) {
      throw new DomainError("SERIES_CONFLICT", "后续课次存在冲突，未调整任何课次", 409, {
        conflicts,
      });
    }
    const allBookings = await this.repository.listBookings(this.organizationId);
    const affectedIds = new Set(affected.map((item) => item.id));
    for (const candidate of candidates) {
      const studentIds = allBookings
        .filter(
          (booking) =>
            booking.sessionId === candidate.id &&
            ACTIVE_BOOKING_STATUSES.includes(booking.status),
        )
        .map((booking) => booking.studentId);
      for (const booking of allBookings) {
        if (
          !studentIds.includes(booking.studentId) ||
          affectedIds.has(booking.sessionId) ||
          !ACTIVE_BOOKING_STATUSES.includes(booking.status)
        ) {
          continue;
        }
        const other = await this.repository.getSession(
          this.organizationId,
          booking.sessionId,
        );
        if (
          other &&
          overlaps(candidate.startsAt, candidate.endsAt, other.startsAt, other.endsAt)
        ) {
          throw new DomainError("STUDENT_TIME_CONFLICT", "调课后学生存在时间冲突", 409, {
            studentId: booking.studentId,
            sessionId: candidate.id,
            conflictingSessionId: other.id,
          });
        }
      }
    }
    return this.repository.withTransaction(async () => {
      const results: CourseSession[] = [];
      for (const updated of candidates) {
        const original = affected.find((item) => item.id === updated.id)!;
        const shifted = {
          ...updated,
          bookingOpensAt: new Date(original.bookingOpensAt.getTime() + startDelta),
          bookingClosesAt: new Date(original.bookingClosesAt.getTime() + startDelta),
          cancelDeadlineAt: new Date(original.cancelDeadlineAt.getTime() + startDelta),
        };
        await this.repository.saveSession(this.organizationId, shifted);
        const activeBookings = allBookings.filter(
          (booking) =>
            booking.sessionId === shifted.id &&
            ACTIVE_BOOKING_STATUSES.includes(booking.status),
        );
        await this.notifyGuardians(
          activeBookings,
          "SESSION_RESCHEDULED",
          "课程时间调整",
          `${shifted.courseName}已调整至${shifted.startsAt.toISOString()}`,
          shifted.id,
        );
        await this.audit("SESSION_RESCHEDULED", "CourseSession", shifted.id, {
          scope,
          seriesId: current.seriesId,
          before: { startsAt: original.startsAt.toISOString(), endsAt: original.endsAt.toISOString() },
          after: { startsAt: shifted.startsAt.toISOString(), endsAt: shifted.endsAt.toISOString() },
        });
        results.push(shifted);
      }
      return results;
    });
  }

  async cancelWithScope(
    sessionId: string,
    reason: string | undefined,
    scope: SeriesOperationScope,
  ): Promise<CourseSession[]> {
    if (scope === "THIS") return [await this.cancelSession(sessionId, reason)];
    const current = await this.requireSession(sessionId);
    if (!current.seriesId || current.occurrenceIndex == null) {
      throw new DomainError("SESSION_NOT_IN_SERIES", "当前课次不属于排课系列", 409);
    }
    const all = await this.repository.listSeriesSessions(this.organizationId, current.seriesId);
    const affected = all.filter(
      (item) =>
        item.occurrenceIndex != null &&
        item.occurrenceIndex >= current.occurrenceIndex! &&
        item.status !== "FINISHED",
    );
    return this.repository.withTransaction(async () => {
      const results: CourseSession[] = [];
      for (const item of affected) results.push(await this.cancelSessionRecord(item, reason, scope));
      return results;
    });
  }

  async rescheduleSession(
    sessionId: string,
    input: RescheduleSessionInput,
  ): Promise<CourseSession> {
    return this.repository.withSessionLock(this.organizationId, sessionId, async () => {
      const current = await this.requireSession(sessionId);
      if (current.status === "CANCELLED" || current.status === "FINISHED") {
        throw new DomainError("SESSION_NOT_RESCHEDULABLE", "当前课次不可调课", 409);
      }
      if (input.endsAt <= input.startsAt) {
        throw new DomainError("INVALID_TIME_RANGE", "结束时间必须晚于开始时间", 400);
      }
      if (input.endsAt.getTime() - input.startsAt.getTime() > 8 * 60 * 60 * 1000) {
        throw new DomainError("SESSION_TOO_LONG", "单次课程最长为 8 小时", 400);
      }

      const updated: CourseSession = {
        ...current,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        // 调课保留原有“距开课多久”的预约策略，避免新课次沿用过期时间窗。
        bookingOpensAt: new Date(
          input.startsAt.getTime() -
            (current.startsAt.getTime() - current.bookingOpensAt.getTime()),
        ),
        bookingClosesAt: new Date(
          input.startsAt.getTime() -
            (current.startsAt.getTime() - current.bookingClosesAt.getTime()),
        ),
        cancelDeadlineAt: new Date(
          input.startsAt.getTime() -
            (current.startsAt.getTime() - current.cancelDeadlineAt.getTime()),
        ),
        teacherId: input.teacherId ?? current.teacherId,
        teacherName: input.teacherName ?? current.teacherName,
        classroomId:
          input.classroomId === undefined ? current.classroomId : input.classroomId,
        classroomName:
          input.classroomName === undefined ? current.classroomName : input.classroomName,
      };
      const candidates = await this.repository.listSessions(this.organizationId, {
        from: updated.startsAt,
        to: updated.endsAt,
      });
      const conflicts = candidates.filter(
        (session) =>
          session.id !== sessionId &&
          OCCUPYING_STATUSES.includes(session.status) &&
          overlaps(updated.startsAt, updated.endsAt, session.startsAt, session.endsAt) &&
          (session.teacherId === updated.teacherId ||
            (updated.classroomId !== null &&
              session.classroomId === updated.classroomId)),
      );
      if (conflicts.length > 0) {
        throw new DomainError("SESSION_CONFLICT", "老师或教室在该时段已被占用", 409, {
          conflicts: conflicts.map((session) => ({ sessionId: session.id })),
        });
      }

      const activeBookings = (await this.repository.listBookings(this.organizationId)).filter(
        (booking) =>
          booking.sessionId === sessionId &&
          ACTIVE_BOOKING_STATUSES.includes(booking.status),
      );
      const allBookings = await this.repository.listBookings(this.organizationId);
      for (const booking of activeBookings) {
        const otherBookings = allBookings.filter(
          (item) =>
            item.sessionId !== sessionId &&
            item.studentId === booking.studentId &&
            ACTIVE_BOOKING_STATUSES.includes(item.status),
        );
        for (const other of otherBookings) {
          const otherSession = await this.repository.getSession(
            this.organizationId,
            other.sessionId,
          );
          if (
            otherSession &&
            overlaps(updated.startsAt, updated.endsAt, otherSession.startsAt, otherSession.endsAt)
          ) {
            throw new DomainError("STUDENT_TIME_CONFLICT", "调课后学生存在时间冲突", 409, {
              studentId: booking.studentId,
              conflictingSessionId: otherSession.id,
            });
          }
        }
      }

      await this.repository.saveSession(this.organizationId, updated);
      await this.notifyGuardians(
        activeBookings,
        "SESSION_RESCHEDULED",
        "课程时间调整",
        `${updated.courseName}已调整至${updated.startsAt.toISOString()}`,
        sessionId,
      );
      await this.audit("SESSION_RESCHEDULED", "CourseSession", sessionId, {
        before: {
          startsAt: current.startsAt.toISOString(),
          endsAt: current.endsAt.toISOString(),
        },
        after: {
          startsAt: updated.startsAt.toISOString(),
          endsAt: updated.endsAt.toISOString(),
        },
      });
      return updated;
    });
  }

  async cancelSession(sessionId: string, reason?: string): Promise<CourseSession> {
    return this.repository.withSessionLock(this.organizationId, sessionId, async () => {
      const session = await this.requireSession(sessionId);
      return this.cancelSessionRecord(session, reason, "THIS");
    });
  }

  private async cancelSessionRecord(
    session: CourseSession,
    reason?: string,
    scope: SeriesOperationScope = "THIS",
  ): Promise<CourseSession> {
    if (session.status === "CANCELLED") return session;
    if (session.status === "FINISHED") {
      throw new DomainError("SESSION_NOT_CANCELLABLE", "已结束课次不可停课", 409);
    }
    const bookings = (await this.repository.listBookings(this.organizationId)).filter(
      (booking) =>
        booking.sessionId === session.id &&
        ACTIVE_BOOKING_STATUSES.includes(booking.status),
    );
    for (const booking of bookings) {
      await this.repository.saveBooking(this.organizationId, {
        ...booking,
        status: "COURSE_CANCELLED",
      });
    }
    const cancelled = { ...session, status: "CANCELLED" as const };
    await this.repository.saveSession(this.organizationId, cancelled);
    await this.notifyGuardians(
      bookings,
      "SESSION_CANCELLED",
      "课程停课通知",
      `${session.courseName}已停课${reason ? `：${reason}` : ""}`,
      session.id,
    );
    await this.audit("SESSION_CANCELLED", "CourseSession", session.id, {
      reason: reason ?? null,
      scope,
      seriesId: session.seriesId ?? null,
      cancelledBookingCount: bookings.length,
    });
    return cancelled;
  }

  async book(
    sessionId: string,
    studentId: string,
  ): Promise<{ booking: Booking; alreadyBooked: boolean }> {
    return this.createBooking(sessionId, studentId, false);
  }

  async bookForAdmin(
    sessionId: string,
    studentId: string,
  ): Promise<{ booking: Booking; alreadyBooked: boolean }> {
    return this.createBooking(sessionId, studentId, true);
  }

  async listAdminBookings(filter: AdminBookingFilter): Promise<AdminBookingPage> {
    return this.repository.listAdminBookings(this.organizationId, filter);
  }

  private async createBooking(
    sessionId: string,
    studentId: string,
    isAdminOperation: boolean,
  ): Promise<{ booking: Booking; alreadyBooked: boolean }> {
    return this.repository.withSessionLock(this.organizationId, sessionId, async () => {
      const session = await this.requireSession(sessionId);
      const student = await this.repository.getStudent(this.organizationId, studentId);
      if (!student) {
        throw new DomainError("STUDENT_NOT_FOUND", "学生不存在", 404);
      }
      const bookableStatuses: SessionStatus[] = isAdminOperation
        ? ["PUBLISHED", "CLOSED"]
        : ["PUBLISHED"];
      if (!bookableStatuses.includes(session.status)) {
        throw new DomainError("SESSION_NOT_BOOKABLE", "当前课次不可预约", 409);
      }

      const currentTime = this.now();
      if (
        !isAdminOperation &&
        (currentTime < session.bookingOpensAt || currentTime >= session.bookingClosesAt)
      ) {
        throw new DomainError("OUTSIDE_BOOKING_WINDOW", "当前不在预约开放时间内", 409);
      }

      const existing = await this.repository.findBooking(
        this.organizationId,
        sessionId,
        studentId,
      );
      if (existing && ACTIVE_BOOKING_STATUSES.includes(existing.status)) {
        return { booking: existing, alreadyBooked: true };
      }

      const allBookings = await this.repository.listBookings(this.organizationId);
      const confirmed = allBookings.filter(
        (booking) =>
          booking.sessionId === sessionId &&
          ACTIVE_BOOKING_STATUSES.includes(booking.status),
      );
      if (confirmed.length >= session.capacity) {
        throw new DomainError("SESSION_FULL", "课次名额已满", 409);
      }

      const activeStudentBookings = allBookings.filter(
        (booking) =>
          booking.studentId === studentId &&
          ACTIVE_BOOKING_STATUSES.includes(booking.status),
      );
      for (const booking of activeStudentBookings) {
        const bookedSession = await this.repository.getSession(
          this.organizationId,
          booking.sessionId,
        );
        if (
          bookedSession &&
          overlaps(
            session.startsAt,
            session.endsAt,
            bookedSession.startsAt,
            bookedSession.endsAt,
          )
        ) {
          throw new DomainError("STUDENT_TIME_CONFLICT", "学生已有时间重叠的预约", 409, {
            conflictingSessionId: bookedSession.id,
          });
        }
      }

      const booking: Booking = existing
        ? { ...existing, status: "CONFIRMED", createdAt: currentTime }
        : {
            id: this.createId(),
            sessionId,
            studentId,
            status: "CONFIRMED",
            createdAt: currentTime,
          };
      await this.repository.saveBooking(this.organizationId, booking);
      await this.notifyGuardians(
        [booking],
        "BOOKING_CONFIRMED",
        "预约成功",
        `已成功预约${session.courseName}，上课时间：${session.startsAt.toISOString()}`,
        session.id,
        `booking-confirmed:${booking.id}:${booking.createdAt.getTime()}`,
      );
      await this.notifyUsers(
        [session.teacherId],
        "BOOKING_CONFIRMED",
        "新增课程预约",
        `${student.name}已预约${session.courseName}，上课时间：${session.startsAt.toISOString()}`,
        session.id,
        `booking-confirmed:${booking.id}:${booking.createdAt.getTime()}:teacher`,
      );
      await this.audit(
        isAdminOperation ? "ADMIN_BOOKING_CREATED" : "BOOKING_CREATED",
        "Booking",
        booking.id,
        { sessionId, studentId },
      );
      return { booking, alreadyBooked: false };
    });
  }

  async cancelBooking(bookingId: string): Promise<Booking> {
    const booking = await this.repository.getBooking(this.organizationId, bookingId);
    if (!booking) {
      throw new DomainError("BOOKING_NOT_FOUND", "预约不存在", 404);
    }
    if (booking.status === "CANCELLED") {
      return booking;
    }
    if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
      throw new DomainError("BOOKING_NOT_CANCELLABLE", "当前预约不可取消", 409);
    }

    const session = await this.requireSession(booking.sessionId);
    if (this.now() >= session.cancelDeadlineAt) {
      throw new DomainError(
        "CANCELLATION_DEADLINE_PASSED",
        "已超过自助取消截止时间，请联系管理员",
        409,
      );
    }
    const cancelled = { ...booking, status: "CANCELLED" as const };
    await this.repository.withTransaction(async () => {
      await this.repository.saveBooking(this.organizationId, cancelled);
      await this.notifyGuardians(
        [booking],
        "BOOKING_CANCELLED",
        "预约已取消",
        `${session.courseName}的预约已取消`,
        session.id,
        `booking-cancelled:${booking.id}`,
      );
      await this.notifyUsers(
        [session.teacherId],
        "BOOKING_CANCELLED",
        "课程预约取消",
        `${(await this.repository.getStudent(this.organizationId, booking.studentId))?.name ?? "学生"}已取消${session.courseName}的预约`,
        session.id,
        `booking-cancelled:${booking.id}:teacher`,
      );
      await this.audit("BOOKING_CANCELLED", "Booking", bookingId, {
        sessionId: booking.sessionId,
        studentId: booking.studentId,
      });
    });
    return cancelled;
  }

  async cancelBookingForAdmin(bookingId: string, reason: string): Promise<Booking> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new DomainError("CANCELLATION_REASON_REQUIRED", "代取消必须填写原因", 400);
    }
    const initial = await this.repository.getBooking(this.organizationId, bookingId);
    if (!initial) {
      throw new DomainError("BOOKING_NOT_FOUND", "预约不存在", 404);
    }
    return this.repository.withSessionLock(
      this.organizationId,
      initial.sessionId,
      async () => {
        const booking = await this.repository.getBooking(this.organizationId, bookingId);
        if (!booking) {
          throw new DomainError("BOOKING_NOT_FOUND", "预约不存在", 404);
        }
        if (booking.status === "CANCELLED") return booking;
        if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
          throw new DomainError("BOOKING_NOT_CANCELLABLE", "当前预约不可取消", 409);
        }
        const cancelled = { ...booking, status: "CANCELLED" as const };
        await this.repository.withTransaction(async () => {
          const session = await this.requireSession(booking.sessionId);
          await this.repository.saveBooking(this.organizationId, cancelled);
          await this.notifyGuardians(
            [booking],
            "BOOKING_CANCELLED",
            "预约已取消",
            `${session.courseName}的预约已由管理员取消：${normalizedReason}`,
            session.id,
            `booking-cancelled:${booking.id}`,
          );
          await this.notifyUsers(
            [session.teacherId],
            "BOOKING_CANCELLED",
            "课程预约取消",
            `${(await this.repository.getStudent(this.organizationId, booking.studentId))?.name ?? "学生"}的${session.courseName}预约已由管理员取消：${normalizedReason}`,
            session.id,
            `booking-cancelled:${booking.id}:teacher`,
          );
          await this.audit("ADMIN_BOOKING_CANCELLED", "Booking", bookingId, {
            sessionId: booking.sessionId,
            studentId: booking.studentId,
            reason: normalizedReason,
          });
        });
        return cancelled;
      },
    );
  }

  async markAttendance(
    sessionId: string,
    records: Array<{ bookingId: string; status: AttendanceStatus }>,
  ): Promise<Booking[]> {
    return this.repository.withSessionLock(this.organizationId, sessionId, async () => {
      await this.requireSession(sessionId);
      const uniqueIds = new Set<string>();
      const bookings: Booking[] = [];
      for (const record of records) {
        if (uniqueIds.has(record.bookingId)) {
          throw new DomainError("DUPLICATE_BOOKING", "签到记录包含重复预约", 400);
        }
        uniqueIds.add(record.bookingId);
        if (!ATTENDANCE_STATUSES.includes(record.status)) {
          throw new DomainError("INVALID_ATTENDANCE_STATUS", "签到状态无效", 400);
        }
        const booking = await this.repository.getBooking(
          this.organizationId,
          record.bookingId,
        );
        if (!booking || booking.sessionId !== sessionId) {
          throw new DomainError("BOOKING_NOT_FOUND", "课次内预约不存在", 404);
        }
        if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
          throw new DomainError("BOOKING_NOT_ATTENDABLE", "已取消预约不可签到", 409);
        }
        bookings.push({ ...booking, status: record.status });
      }
      for (const booking of bookings) {
        await this.repository.saveBooking(this.organizationId, booking);
      }
      await this.audit("ATTENDANCE_UPDATED", "CourseSession", sessionId, {
        records: bookings.map(({ id, status }) => ({ bookingId: id, status })),
      });
      return bookings;
    });
  }

  async listNotifications(userId: string, unreadOnly = false): Promise<Notification[]> {
    return this.repository.listNotifications(this.organizationId, userId, unreadOnly);
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await this.repository.getNotification(
      this.organizationId,
      notificationId,
    );
    if (!notification || notification.userId !== userId) {
      throw new DomainError("NOTIFICATION_NOT_FOUND", "通知不存在", 404);
    }
    if (notification.readAt) return notification;
    const read = { ...notification, readAt: this.now() };
    await this.repository.saveNotification(this.organizationId, read);
    await this.audit("NOTIFICATION_READ", "Notification", notificationId, {});
    return read;
  }

  async listAuditLogs(): Promise<AuditLog[]> {
    return this.repository.listAuditLogs(this.organizationId);
  }

  async enqueueDueReminders(): Promise<number> {
    const now = this.now();
    const sessions = await this.repository.listSessions(this.organizationId, {
      from: now,
      to: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    const bookings = await this.repository.listBookings(this.organizationId);
    let created = 0;
    for (const session of sessions) {
      if (!["PUBLISHED", "CLOSED"].includes(session.status)) continue;
      const activeBookings = bookings.filter(
        (booking) =>
          booking.sessionId === session.id &&
          ACTIVE_BOOKING_STATUSES.includes(booking.status),
      );
      for (const hours of [24, 2] as const) {
        if (now.getTime() < session.startsAt.getTime() - hours * 60 * 60 * 1000) continue;
        created += await this.notifyGuardians(
          activeBookings,
          hours === 24 ? "SESSION_REMINDER_24H" : "SESSION_REMINDER_2H",
          `开课前${hours}小时提醒`,
          `${session.courseName}将于${session.startsAt.toISOString()}开课`,
          session.id,
          `session-reminder-${hours}h:${session.id}`,
        );
        created += await this.notifyUsers(
          [session.teacherId],
          hours === 24 ? "SESSION_REMINDER_24H" : "SESSION_REMINDER_2H",
          `开课前${hours}小时提醒`,
          `${session.courseName}将于${session.startsAt.toISOString()}开课`,
          session.id,
          `session-reminder-${hours}h:${session.id}:teacher`,
        );
      }
    }
    return created;
  }

  async getRoster(
    sessionId: string,
  ): Promise<Array<Student & { bookingId: string; bookingStatus: BookingStatus }>> {
    await this.requireSession(sessionId);
    const bookings = (await this.repository.listBookings(this.organizationId)).filter(
      (booking) =>
        booking.sessionId === sessionId &&
        ACTIVE_BOOKING_STATUSES.includes(booking.status),
    );
    const roster = await Promise.all(
      bookings.map(async (booking) => {
        const student = await this.repository.getStudent(
          this.organizationId,
          booking.studentId,
        );
        return student
          ? { ...student, bookingId: booking.id, bookingStatus: booking.status }
          : undefined;
      }),
    );
    return roster.filter(
      (
        student,
      ): student is Student & { bookingId: string; bookingStatus: BookingStatus } =>
        student !== undefined,
    );
  }

  private async requireSession(id: string): Promise<CourseSession> {
    const session = await this.repository.getSession(this.organizationId, id);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "课次不存在", 404);
    }
    return session;
  }

  private async notifyGuardians(
    bookings: Booking[],
    type: NotificationType,
    title: string,
    content: string,
    sessionId: string,
    eventKey = `${type}:${sessionId}`,
  ): Promise<number> {
    const guardianIds = await this.repository.listGuardianIdsByStudentIds(
      this.organizationId,
      [...new Set(bookings.map((booking) => booking.studentId))],
    );
    return this.notifyUsers(
      guardianIds,
      type,
      title,
      content,
      sessionId,
      eventKey,
    );
  }

  private async notifyUsers(
    userIds: string[],
    type: NotificationType,
    title: string,
    content: string,
    sessionId: string,
    eventKey: string,
  ): Promise<number> {
    let created = 0;
    for (const userId of [...new Set(userIds)]) {
      if (!(await this.repository.getUserIdentity(this.organizationId, userId))) {
        continue;
      }
      const idempotencyKey = `${eventKey}:${userId}`;
      const notification: Notification = {
        id: this.createId(),
        userId,
        type,
        title,
        content,
        sessionId,
        idempotencyKey,
        readAt: null,
        createdAt: this.now(),
      };
      const now = this.now();
      if (
        await this.repository.saveNotificationWithDelivery(
          this.organizationId,
          notification,
          {
            id: this.createId(),
            notificationId: notification.id,
            userId,
            channel: "WECHAT",
            status: "PENDING",
            attemptCount: 0,
            lastError: null,
            idempotencyKey,
            payload: { type, title, content, sessionId, page: "/pages/parent/index" },
            nextAttemptAt: now,
            sentAt: null,
            createdAt: now,
            updatedAt: now,
          },
        )
      ) {
        created += 1;
      }
    }
    return created;
  }

  private async audit(
    action: string,
    entityType: string,
    entityId: string,
    details: unknown,
  ): Promise<void> {
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
