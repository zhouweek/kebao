import type { AuthRepository } from "./auth.js";
import type { PlatformRepository } from "./platform.js";
import type { MasterDataRepository } from "./master-data.js";
import type { CoursePackageRepository } from "./course-packages.js";
import {
  shanghaiBusinessDate,
  type CreditLedger,
  type CreditReservation,
  type StudentCourseEntitlement,
} from "./course-packages.js";

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
  entitlementId?: string | null;
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
  | "SESSION_REMINDER_2H"
  | "COURSE_PACKAGE_PURCHASED"
  | "ENTITLEMENT_LOW_BALANCE"
  | "ENTITLEMENT_EXPIRING"
  | "ENTITLEMENT_EXPIRED";
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
  entitlementId: string | null;
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

export interface Repository
  extends AuthRepository,
    PlatformRepository,
    MasterDataRepository,
    CoursePackageRepository {
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
const SETTLEMENT_RETRY_MAX_DELAY_MINUTES = 60;

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
    return this.withLockedSession(sessionId, async () => {
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
      await this.correctReservation(booking, "RELEASE", "课次取消");
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
    return this.withLockedSession(sessionId, async () => {
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
            entitlementId: null,
            status: "CONFIRMED",
            createdAt: currentTime,
          };
      const previousReservation = existing
        ? await this.repository.getCreditReservationByBooking(this.organizationId, existing.id)
        : undefined;
      const reservation = previousReservation
        ? await this.reopenReservation(existing!, previousReservation, session, currentTime)
        : await this.reserveCredit(booking, session, currentTime);
      booking.entitlementId = reservation?.entitlementId ?? null;
      await this.repository.saveBooking(this.organizationId, booking);
      if (reservation && !previousReservation) {
        await this.repository.saveCreditReservation(this.organizationId, reservation);
        await this.appendLedger({
          entitlementId: reservation.entitlementId,
          reservation,
          booking,
          type: "RESERVE",
          creditDelta: 0,
          reservedCreditDelta: 1,
          key: `booking:${booking.id}:reserve`,
          occurredAt: currentTime,
        });
      }
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
    const initial = await this.repository.getBooking(this.organizationId, bookingId);
    if (!initial) {
      throw new DomainError("BOOKING_NOT_FOUND", "预约不存在", 404);
    }
    return this.withLockedSession(initial.sessionId, async () => {
      const booking = await this.repository.getBooking(this.organizationId, bookingId);
      if (!booking) throw new DomainError("BOOKING_NOT_FOUND", "预约不存在", 404);
      if (booking.status === "CANCELLED") return booking;
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
      const reservation = await this.repository.getCreditReservationByBooking(
        this.organizationId,
        booking.id,
      );
      const cancellationCycle = reservation?.updatedAt.getTime() ?? booking.createdAt.getTime();
      const cancelled = { ...booking, status: "CANCELLED" as const };
      await this.correctReservation(booking, "RELEASE", "预约提前取消");
      await this.repository.saveBooking(this.organizationId, cancelled);
      await this.notifyGuardians(
        [booking],
        "BOOKING_CANCELLED",
        "预约已取消",
        `${session.courseName}的预约已取消`,
        session.id,
        `booking-cancelled:${booking.id}:${cancellationCycle}`,
      );
      await this.notifyUsers(
        [session.teacherId],
        "BOOKING_CANCELLED",
        "课程预约取消",
        `${(await this.repository.getStudent(this.organizationId, booking.studentId))?.name ?? "学生"}已取消${session.courseName}的预约`,
        session.id,
        `booking-cancelled:${booking.id}:${cancellationCycle}:teacher`,
      );
      await this.audit("BOOKING_CANCELLED", "Booking", bookingId, {
        sessionId: booking.sessionId,
        studentId: booking.studentId,
      });
      return cancelled;
    });
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
    return this.withLockedSession(initial.sessionId, async () => {
      const booking = await this.repository.getBooking(this.organizationId, bookingId);
      if (!booking) {
        throw new DomainError("BOOKING_NOT_FOUND", "预约不存在", 404);
      }
      if (booking.status === "CANCELLED") return booking;
      if (booking.status !== "CONFIRMED") {
        throw new DomainError("BOOKING_NOT_CANCELLABLE", "当前预约不可取消", 409);
      }
      const cancelled = { ...booking, status: "CANCELLED" as const };
      const session = await this.requireSession(booking.sessionId);
      if (this.now() >= session.endsAt) {
        throw new DomainError("BOOKING_NOT_CANCELLABLE", "课次结束后不可取消预约", 409);
      }
      const reservation = await this.repository.getCreditReservationByBooking(
        this.organizationId,
        booking.id,
      );
      const cancellationCycle = reservation?.updatedAt.getTime() ?? booking.createdAt.getTime();
      const late = this.now() >= session.cancelDeadlineAt;
      const target = late
        ? await this.lateCancellationSettlement(booking)
        : "RELEASE";
      await this.correctReservation(
        booking,
        target,
        target === "CONSUME"
          ? `管理员晚取消：${normalizedReason}`
          : late
            ? `管理员晚取消释放：${normalizedReason}`
            : `管理员提前取消：${normalizedReason}`,
      );
      await this.repository.saveBooking(this.organizationId, cancelled);
      await this.notifyGuardians(
        [booking],
        "BOOKING_CANCELLED",
        "预约已取消",
        `${session.courseName}的预约已由管理员取消：${normalizedReason}`,
        session.id,
        `booking-cancelled:${booking.id}:${cancellationCycle}`,
      );
      await this.notifyUsers(
        [session.teacherId],
        "BOOKING_CANCELLED",
        "课程预约取消",
        `${(await this.repository.getStudent(this.organizationId, booking.studentId))?.name ?? "学生"}的${session.courseName}预约已由管理员取消：${normalizedReason}`,
        session.id,
        `booking-cancelled:${booking.id}:${cancellationCycle}:teacher`,
      );
      await this.audit("ADMIN_BOOKING_CANCELLED", "Booking", bookingId, {
        sessionId: booking.sessionId,
        studentId: booking.studentId,
        reason: normalizedReason,
        late,
        settlement: target,
      });
      return cancelled;
    });
  }

  async markAttendance(
    sessionId: string,
    records: Array<{ bookingId: string; status: AttendanceStatus }>,
  ): Promise<Booking[]> {
    return this.withLockedSession(sessionId, async () => {
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
      const changedRecords: Booking[] = [];
      for (let index = 0; index < bookings.length; index += 1) {
        const booking = bookings[index]!;
        const previous = await this.repository.getBooking(this.organizationId, booking.id);
        if (!previous || previous.status === booking.status) continue;
        const target = await this.attendanceSettlement(booking, booking.status as AttendanceStatus);
        await this.correctReservation(previous, target, `签到：${booking.status}`);
        await this.repository.saveBooking(this.organizationId, booking);
        changedRecords.push(booking);
      }
      if (changedRecords.length > 0) {
        await this.audit("ATTENDANCE_UPDATED", "CourseSession", sessionId, {
          records: changedRecords.map(({ id, status }) => ({ bookingId: id, status })),
        });
      }
      return bookings;
    });
  }

  async settleExpiredReservations(limit = 100): Promise<number> {
    const timestamp = this.now();
    let settled = 0;
    const attemptedReservationIds = new Set<string>();
    while (settled < limit && attemptedReservationIds.size < limit) {
      const reservations = await this.repository.listExpiredCreditReservations(
        this.organizationId,
        timestamp,
        limit - attemptedReservationIds.size,
        [...attemptedReservationIds],
      );
      const newCandidates = reservations.filter(
        (candidate) => !attemptedReservationIds.has(candidate.id),
      );
      if (newCandidates.length === 0) break;
      for (const candidate of newCandidates) {
        if (attemptedReservationIds.size >= limit) break;
        attemptedReservationIds.add(candidate.id);
        let sessionId: string | undefined;
        try {
          const initialBooking = await this.repository.getBooking(
            this.organizationId,
            candidate.bookingId,
          );
          if (!initialBooking) continue;
          sessionId = initialBooking.sessionId;
          settled += await this.withLockedSession(initialBooking.sessionId, async () => {
            const [booking, reservation, session] = await Promise.all([
              this.repository.getBooking(this.organizationId, candidate.bookingId),
              this.repository.getCreditReservationByBooking(
                this.organizationId,
                candidate.bookingId,
              ),
              this.repository.getSession(this.organizationId, initialBooking.sessionId),
            ]);
            if (
              !booking ||
              !reservation ||
              !session ||
              booking.status !== "CONFIRMED" ||
              reservation.status !== "RESERVED" ||
              reservation.expiresAt === null ||
              reservation.expiresAt > timestamp ||
              session.endsAt > timestamp
            ) {
              return 0;
            }
            const target = await this.attendanceSettlement(booking, "ABSENT");
            await this.correctReservation(booking, target, "课次结束未签到自动结算");
            await this.repository.saveBooking(this.organizationId, {
              ...booking,
              status: "ABSENT",
            });
            await this.audit("BOOKING_AUTO_SETTLED_ABSENT", "Booking", booking.id, {
              sessionId: booking.sessionId,
              settlement: target,
              reservationId: reservation.id,
            });
            return 1;
          });
        } catch (error) {
          const diagnostic = this.errorDiagnostic(error);
          const failedAt = this.now();
          const settlementAttemptCount = candidate.settlementAttemptCount + 1;
          const nextSettlementAttemptAt = new Date(
            failedAt.getTime() +
              Math.min(
                SETTLEMENT_RETRY_MAX_DELAY_MINUTES,
                2 ** settlementAttemptCount,
              ) *
                60_000,
          );
          console.error("过期课时预占自动结算失败", {
            organizationId: this.organizationId,
            bookingId: candidate.bookingId,
            reservationId: candidate.id,
            sessionId: sessionId ?? null,
            error: diagnostic,
          });
          try {
            await this.repository.saveCreditReservationSettlementFailure(
              this.organizationId,
              {
                id: candidate.id,
                settlementAttemptCount,
                nextSettlementAttemptAt,
                settlementLastError: diagnostic.message.slice(0, 1000),
                updatedAt: failedAt,
              },
              candidate.settlementAttemptCount,
            );
          } catch (persistenceError) {
            console.error("过期课时预占失败状态写入失败", {
              organizationId: this.organizationId,
              bookingId: candidate.bookingId,
              reservationId: candidate.id,
              settlementError: diagnostic,
              persistenceError: this.errorDiagnostic(persistenceError),
            });
          }
          try {
            await this.audit(
              "BOOKING_AUTO_SETTLEMENT_FAILED",
              "Booking",
              candidate.bookingId,
              {
                reservationId: candidate.id,
                sessionId: sessionId ?? null,
                error: diagnostic,
              },
            );
          } catch (auditError) {
            console.error("过期课时预占失败审计写入失败", {
              organizationId: this.organizationId,
              bookingId: candidate.bookingId,
              reservationId: candidate.id,
              settlementError: diagnostic,
              auditError: this.errorDiagnostic(auditError),
            });
          }
        }
      }
    }
    return settled;
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

  private async withLockedSession<T>(
    sessionId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.repository.withTransaction(() =>
      this.repository.withSessionLock(this.organizationId, sessionId, action),
    );
  }

  private async reserveCredit(
    booking: Booking,
    session: CourseSession,
    timestamp: Date,
  ): Promise<CreditReservation | undefined> {
    const businessDate = shanghaiBusinessDate(session.startsAt);
    const entitlements = await this.repository.listUsableStudentEntitlements(
      this.organizationId,
      booking.studentId,
      session.courseId,
      businessDate,
    );
    const entitlement = entitlements.find(
      (item) => item.remainingCredits - item.reservedCredits >= 1,
    );
    if (!entitlement) {
      const configuredPackages = await this.repository.listCoursePackages(this.organizationId, {
        page: 1,
        pageSize: 1,
        courseId: session.courseId,
      });
      // 兼容启用课包前产生的机构数据；一旦课程配置过课包，即强制使用权益。
      if (configuredPackages.total === 0) return undefined;
      throw new DomainError("INSUFFICIENT_COURSE_CREDITS", "该课程没有可用课时权益", 409);
    }
    const updated: StudentCourseEntitlement = {
      ...entitlement,
      reservedCredits: entitlement.reservedCredits + 1,
      version: entitlement.version + 1,
      updatedAt: timestamp,
    };
    if (
      !(await this.repository.saveStudentEntitlement(
        this.organizationId,
        updated,
        entitlement.version,
      ))
    ) {
      throw new DomainError("ENTITLEMENT_CONFLICT", "权益已被其他操作修改，请重试", 409);
    }
    return {
      id: this.createId(),
      entitlementId: entitlement.id,
      bookingId: booking.id,
      credits: 1,
      status: "RESERVED",
      expiresAt: session.endsAt,
      releasedAt: null,
      consumedAt: null,
      settlementAttemptCount: 0,
      nextSettlementAttemptAt: null,
      settlementLastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private async attendanceSettlement(
    booking: Booking,
    status: AttendanceStatus,
  ): Promise<"CONSUME" | "RELEASE"> {
    if (status === "ATTENDED") return "CONSUME";
    if (status === "LEAVE") return "RELEASE";
    const reservation = await this.repository.getCreditReservationByBooking(
      this.organizationId,
      booking.id,
    );
    if (!reservation) return "RELEASE";
    const entitlement = await this.repository.getStudentEntitlement(
      this.organizationId,
      reservation.entitlementId,
    );
    if (!entitlement) throw new DomainError("ENTITLEMENT_NOT_FOUND", "预约权益不存在", 409);
    const purchase = await this.repository.getCoursePurchase(
      this.organizationId,
      entitlement.purchaseId,
    );
    if (!purchase) throw new DomainError("COURSE_PURCHASE_NOT_FOUND", "权益购买记录不存在", 409);
    return purchase.absentDeductsCreditSnapshot ? "CONSUME" : "RELEASE";
  }

  private async lateCancellationSettlement(
    booking: Booking,
  ): Promise<"CONSUME" | "RELEASE"> {
    const reservation = await this.repository.getCreditReservationByBooking(
      this.organizationId,
      booking.id,
    );
    if (!reservation) return "RELEASE";
    const entitlement = await this.repository.getStudentEntitlement(
      this.organizationId,
      reservation.entitlementId,
    );
    if (!entitlement) throw new DomainError("ENTITLEMENT_NOT_FOUND", "预约权益不存在", 409);
    const purchase = await this.repository.getCoursePurchase(
      this.organizationId,
      entitlement.purchaseId,
    );
    if (!purchase) throw new DomainError("COURSE_PURCHASE_NOT_FOUND", "权益购买记录不存在", 409);
    return purchase.lateCancellationDeductsCreditSnapshot ? "CONSUME" : "RELEASE";
  }

  private async correctReservation(
    previousBooking: Booking,
    target: "CONSUME" | "RELEASE",
    note: string,
  ): Promise<void> {
    const reservation = await this.repository.getCreditReservationByBooking(
      this.organizationId,
      previousBooking.id,
    );
    if (!reservation) return;
    if (reservation.status === "RESERVED") {
      await this.settleReservation(previousBooking, target, note);
      return;
    }
    const currentEffect = reservation.status === "CONSUMED" ? "CONSUME" : "RELEASE";
    if (currentEffect === target) return;
    const ledgers = await this.repository.listCreditLedgers(
      this.organizationId,
      reservation.entitlementId,
    );
    const reversedIds = new Set(
      ledgers.filter((item) => item.type === "REVERSAL" && item.reversalOfId).map((item) => item.reversalOfId!),
    );
    const original = ledgers.find(
      (item) =>
        item.bookingId === previousBooking.id &&
        item.type === currentEffect &&
        !reversedIds.has(item.id),
    );
    if (!original) {
      throw new DomainError("LEDGER_STATE_CONFLICT", "预约课时流水状态不一致", 409);
    }
    const entitlement = await this.requireRawEntitlement(reservation.entitlementId);
    if (
      currentEffect === "RELEASE" &&
      target === "CONSUME" &&
      entitlement.remainingCredits - entitlement.reservedCredits < reservation.credits
    ) {
      throw new DomainError(
        "RESERVATION_RESTORE_INSUFFICIENT_CREDITS",
        "当前权益可用余额不足，无法恢复原预约预占",
        409,
      );
    }
    const timestamp = this.now();
    const reversedEntitlement: StudentCourseEntitlement = {
      ...entitlement,
      remainingCredits: entitlement.remainingCredits - original.creditDelta,
      reservedCredits: entitlement.reservedCredits - original.reservedCreditDelta,
      status: this.entitlementStatusAfterBalance(
        entitlement,
        entitlement.remainingCredits - original.creditDelta,
        timestamp,
      ),
      version: entitlement.version + 1,
      updatedAt: timestamp,
    };
    await this.saveEntitlementCas(entitlement, reversedEntitlement);
    await this.repository.saveCreditLedger(this.organizationId, {
      id: this.createId(),
      entitlementId: entitlement.id,
      purchaseId: null,
      reservationId: null,
      bookingId: null,
      idempotencyKey: `booking:${previousBooking.id}:reversal:${original.id}`,
      type: "REVERSAL",
      creditDelta: -original.creditDelta,
      balanceAfter: reversedEntitlement.remainingCredits,
      reservedCreditDelta: -original.reservedCreditDelta,
      reservedBalanceAfter: reversedEntitlement.reservedCredits,
      reversalOfId: original.id,
      actorId: this.actorId,
      note: `冲正：${note}`,
      occurredAt: timestamp,
      createdAt: timestamp,
    });
    await this.repository.saveCreditReservation(this.organizationId, {
      ...reservation,
      status: "RESERVED",
      releasedAt: null,
      consumedAt: null,
      updatedAt: timestamp,
    });
    await this.settleReservation(previousBooking, target, note);
  }

  private async reopenReservation(
    booking: Booking,
    reservation: CreditReservation,
    session: CourseSession,
    timestamp: Date,
  ): Promise<CreditReservation> {
    if (reservation.status === "RESERVED") return reservation;
    if (reservation.status !== "RELEASED") {
      throw new DomainError("RESERVATION_STATE_CONFLICT", "已核销预约不可重新预约", 409);
    }
    const ledgers = await this.repository.listCreditLedgers(
      this.organizationId,
      reservation.entitlementId,
    );
    const reversedIds = new Set(
      ledgers.filter((item) => item.type === "REVERSAL" && item.reversalOfId).map((item) => item.reversalOfId!),
    );
    const released = ledgers.find(
      (item) =>
        item.bookingId === booking.id &&
        item.type === "RELEASE" &&
        !reversedIds.has(item.id),
    );
    if (!released) {
      throw new DomainError("LEDGER_STATE_CONFLICT", "预约释放流水不存在", 409);
    }
    const entitlement = await this.repository.getStudentEntitlement(
      this.organizationId,
      reservation.entitlementId,
    );
    const businessDate = shanghaiBusinessDate(session.startsAt);
    if (
      !entitlement ||
      entitlement.studentId !== booking.studentId ||
      entitlement.courseId !== session.courseId ||
      entitlement.status !== "ACTIVE" ||
      entitlement.validFrom > businessDate ||
      entitlement.validUntil < businessDate ||
      entitlement.remainingCredits - entitlement.reservedCredits < 1
    ) {
      throw new DomainError(
        "INSUFFICIENT_COURSE_CREDITS",
        "原预约权益已失效或课时余额不足",
        409,
      );
    }
    const updated: StudentCourseEntitlement = {
      ...entitlement,
      reservedCredits: entitlement.reservedCredits + 1,
      version: entitlement.version + 1,
      updatedAt: timestamp,
    };
    await this.saveEntitlementCas(entitlement, updated);
    await this.repository.saveCreditLedger(this.organizationId, {
      id: this.createId(),
      entitlementId: entitlement.id,
      purchaseId: null,
      reservationId: null,
      bookingId: null,
      idempotencyKey: `booking:${booking.id}:rebook-reversal:${released.id}`,
      type: "REVERSAL",
      creditDelta: 0,
      balanceAfter: updated.remainingCredits,
      reservedCreditDelta: 1,
      reservedBalanceAfter: updated.reservedCredits,
      reversalOfId: released.id,
      actorId: this.actorId,
      note: "取消后重新预约",
      occurredAt: timestamp,
      createdAt: timestamp,
    });
    const reopened = {
      ...reservation,
      status: "RESERVED" as const,
      expiresAt: session.endsAt,
      releasedAt: null,
      consumedAt: null,
      updatedAt: timestamp,
    };
    await this.repository.saveCreditReservation(this.organizationId, reopened);
    return reopened;
  }

  private async settleReservation(
    booking: Booking,
    target: "CONSUME" | "RELEASE",
    note: string,
  ): Promise<void> {
    const reservation = await this.repository.getCreditReservationByBooking(
      this.organizationId,
      booking.id,
    );
    if (!reservation) return;
    if (
      (target === "CONSUME" && reservation.status === "CONSUMED") ||
      (target === "RELEASE" && reservation.status === "RELEASED")
    ) return;
    if (reservation.status !== "RESERVED") {
      throw new DomainError("RESERVATION_STATE_CONFLICT", "课时预占状态不允许当前操作", 409);
    }
    const entitlement = await this.requireRawEntitlement(reservation.entitlementId);
    const timestamp = this.now();
    const consume = target === "CONSUME";
    const updated: StudentCourseEntitlement = {
      ...entitlement,
      remainingCredits: entitlement.remainingCredits - (consume ? 1 : 0),
      reservedCredits: entitlement.reservedCredits - 1,
      status: this.entitlementStatusAfterBalance(
        entitlement,
        entitlement.remainingCredits - (consume ? 1 : 0),
        timestamp,
      ),
      version: entitlement.version + 1,
      updatedAt: timestamp,
    };
    await this.saveEntitlementCas(entitlement, updated);
    await this.repository.saveCreditReservation(this.organizationId, {
      ...reservation,
      status: consume ? "CONSUMED" : "RELEASED",
      consumedAt: consume ? timestamp : null,
      releasedAt: consume ? null : timestamp,
      nextSettlementAttemptAt: null,
      settlementLastError: null,
      updatedAt: timestamp,
    });
    await this.appendLedger({
      entitlementId: entitlement.id,
      reservation,
      booking,
      type: target,
      creditDelta: consume ? -1 : 0,
      reservedCreditDelta: -1,
      key: `booking:${booking.id}:${target.toLowerCase()}:${reservation.updatedAt.getTime()}`,
      occurredAt: timestamp,
      note,
    });
  }

  private async appendLedger(input: {
    entitlementId: string;
    reservation: CreditReservation;
    booking: Booking;
    type: "RESERVE" | "RELEASE" | "CONSUME";
    creditDelta: number;
    reservedCreditDelta: number;
    key: string;
    occurredAt: Date;
    note?: string;
  }): Promise<void> {
    const entitlement = await this.requireRawEntitlement(input.entitlementId);
    const ledger: CreditLedger = {
      id: this.createId(),
      entitlementId: input.entitlementId,
      purchaseId: null,
      reservationId: input.reservation.id,
      bookingId: input.booking.id,
      idempotencyKey: input.key,
      type: input.type,
      creditDelta: input.creditDelta,
      balanceAfter: entitlement.remainingCredits,
      reservedCreditDelta: input.reservedCreditDelta,
      reservedBalanceAfter: entitlement.reservedCredits,
      reversalOfId: null,
      actorId: this.actorId,
      note: input.note ?? null,
      occurredAt: input.occurredAt,
      createdAt: input.occurredAt,
    };
    await this.repository.saveCreditLedger(this.organizationId, ledger);
  }

  private async requireReservation(bookingId: string): Promise<CreditReservation> {
    const reservation = await this.repository.getCreditReservationByBooking(
      this.organizationId,
      bookingId,
    );
    if (!reservation) {
      throw new DomainError("CREDIT_RESERVATION_NOT_FOUND", "预约课时预占不存在", 409);
    }
    return reservation;
  }

  private async requireRawEntitlement(id: string): Promise<StudentCourseEntitlement> {
    const entitlement = await this.repository.getStudentEntitlement(this.organizationId, id);
    if (!entitlement) throw new DomainError("ENTITLEMENT_NOT_FOUND", "学生权益不存在", 409);
    return entitlement;
  }

  private async saveEntitlementCas(
    previous: StudentCourseEntitlement,
    next: StudentCourseEntitlement,
  ): Promise<void> {
    if (
      !(await this.repository.saveStudentEntitlement(
        this.organizationId,
        next,
        previous.version,
      ))
    ) {
      throw new DomainError("ENTITLEMENT_CONFLICT", "权益已被其他操作修改，请重试", 409);
    }
  }

  private entitlementStatusAfterBalance(
    entitlement: StudentCourseEntitlement,
    remainingCredits: number,
    timestamp: Date,
  ): StudentCourseEntitlement["status"] {
    if (entitlement.status === "CANCELLED") return "CANCELLED";
    if (remainingCredits === 0) return "EXHAUSTED";
    return entitlement.validUntil < shanghaiBusinessDate(timestamp) ? "EXPIRED" : "ACTIVE";
  }

  private errorDiagnostic(error: unknown): { name: string; message: string; code?: string } {
    if (error instanceof DomainError) {
      return { name: error.name, message: error.message, code: error.code };
    }
    if (error instanceof Error) {
      return { name: error.name, message: error.message };
    }
    return { name: "UnknownError", message: String(error) };
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
        entitlementId: null,
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
