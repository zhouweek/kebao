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
}

export interface Student {
  id: string;
  name: string;
  guardianPhone: string;
}

export interface Booking {
  id: string;
  sessionId: string;
  studentId: string;
  status: BookingStatus;
  createdAt: Date;
}

export type AttendanceStatus = "ATTENDED" | "LEAVE" | "ABSENT";
export type NotificationType = "SESSION_RESCHEDULED" | "SESSION_CANCELLED";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  sessionId: string | null;
  readAt: Date | null;
  createdAt: Date;
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

export interface Repository {
  organizationExists(organizationId: string): Promise<boolean>;
  getUserIdentity(organizationId: string, userId: string): Promise<UserIdentity | undefined>;
  isGuardianOfStudent(
    organizationId: string,
    guardianId: string,
    studentId: string,
  ): Promise<boolean>;
  listSessions(organizationId: string, filter: SessionFilter): Promise<CourseSession[]>;
  getSession(organizationId: string, id: string): Promise<CourseSession | undefined>;
  saveSession(organizationId: string, session: CourseSession): Promise<void>;
  getStudent(organizationId: string, id: string): Promise<Student | undefined>;
  listBookings(organizationId: string): Promise<Booking[]>;
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
  listNotifications(
    organizationId: string,
    userId: string,
    unreadOnly?: boolean,
  ): Promise<Notification[]>;
  getNotification(
    organizationId: string,
    id: string,
  ): Promise<Notification | undefined>;
  saveAuditLog(organizationId: string, auditLog: AuditLog): Promise<void>;
  listAuditLogs(organizationId: string): Promise<AuditLog[]>;
  withSessionLock<T>(
    organizationId: string,
    sessionId: string,
    action: () => Promise<T>,
  ): Promise<T>;
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
    };
    await this.repository.saveSession(this.organizationId, session);
    await this.audit("SESSION_CREATED", "CourseSession", session.id, {
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
    });
    return session;
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
      if (session.status === "CANCELLED") return session;
      if (session.status === "FINISHED") {
        throw new DomainError("SESSION_NOT_CANCELLABLE", "已结束课次不可停课", 409);
      }
      const bookings = (await this.repository.listBookings(this.organizationId)).filter(
        (booking) =>
          booking.sessionId === sessionId &&
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
        sessionId,
      );
      await this.audit("SESSION_CANCELLED", "CourseSession", sessionId, {
        reason: reason ?? null,
        cancelledBookingCount: bookings.length,
      });
      return cancelled;
    });
  }

  async book(
    sessionId: string,
    studentId: string,
  ): Promise<{ booking: Booking; alreadyBooked: boolean }> {
    return this.repository.withSessionLock(this.organizationId, sessionId, async () => {
      const session = await this.requireSession(sessionId);
      const student = await this.repository.getStudent(this.organizationId, studentId);
      if (!student) {
        throw new DomainError("STUDENT_NOT_FOUND", "学生不存在", 404);
      }
      if (session.status !== "PUBLISHED") {
        throw new DomainError("SESSION_NOT_BOOKABLE", "当前课次不可预约", 409);
      }

      const currentTime = this.now();
      if (currentTime < session.bookingOpensAt || currentTime >= session.bookingClosesAt) {
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
      await this.audit("BOOKING_CREATED", "Booking", booking.id, { sessionId, studentId });
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
    await this.repository.saveBooking(this.organizationId, cancelled);
    await this.audit("BOOKING_CANCELLED", "Booking", bookingId, {
      sessionId: booking.sessionId,
      studentId: booking.studentId,
    });
    return cancelled;
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
  ): Promise<void> {
    const guardianIds = await this.repository.listGuardianIdsByStudentIds(
      this.organizationId,
      [...new Set(bookings.map((booking) => booking.studentId))],
    );
    for (const userId of guardianIds) {
      await this.repository.saveNotification(this.organizationId, {
        id: this.createId(),
        userId,
        type,
        title,
        content,
        sessionId,
        readAt: null,
        createdAt: this.now(),
      });
    }
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
