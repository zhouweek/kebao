import { AsyncLocalStorage } from "node:async_hooks";
import {
  Prisma,
  PrismaClient,
  type Booking as PrismaBooking,
  type CourseSession as PrismaSession,
  type Notification as PrismaNotification,
} from "@prisma/client";
import {
  type AuditLog,
  DomainError,
  type Booking,
  type CourseSession,
  type Notification,
  type Repository,
  type SessionFilter,
  type Student,
  type UserIdentity,
} from "./domain.js";

type SessionRow = PrismaSession & {
  course: { name: string };
  campus: { name: string };
  classroom: { name: string } | null;
  teacher: { name: string };
};

const sessionInclude = {
  course: { select: { name: true } },
  campus: { select: { name: true } },
  classroom: { select: { name: true } },
  teacher: { select: { name: true } },
} satisfies Prisma.CourseSessionInclude;

export class PrismaRepository implements Repository {
  private readonly transactions = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(private readonly prisma: PrismaClient) {}

  async organizationExists(organizationId: string): Promise<boolean> {
    return (
      (await this.client.organization.count({ where: { id: organizationId } })) === 1
    );
  }

  async getUserIdentity(
    organizationId: string,
    userId: string,
  ): Promise<UserIdentity | undefined> {
    const user = await this.client.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, organizationId: true, role: true },
    });
    return user ?? undefined;
  }

  async isGuardianOfStudent(
    organizationId: string,
    guardianId: string,
    studentId: string,
  ): Promise<boolean> {
    return (
      (await this.client.studentGuardian.count({
        where: { organizationId, guardianId, studentId },
      })) === 1
    );
  }

  async listSessions(
    organizationId: string,
    filter: SessionFilter,
  ): Promise<CourseSession[]> {
    const rows = await this.client.courseSession.findMany({
      where: {
        organizationId,
        ...(filter.from ? { endsAt: { gt: filter.from } } : {}),
        ...(filter.to ? { startsAt: { lt: filter.to } } : {}),
        ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
        ...(filter.campusId ? { campusId: filter.campusId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: sessionInclude,
      orderBy: { startsAt: "asc" },
    });
    return rows.map((row) => this.toSession(row));
  }

  async getSession(
    organizationId: string,
    id: string,
  ): Promise<CourseSession | undefined> {
    const row = await this.client.courseSession.findFirst({
      where: { id, organizationId },
      include: sessionInclude,
    });
    return row ? this.toSession(row) : undefined;
  }

  async saveSession(
    organizationId: string,
    session: CourseSession,
  ): Promise<void> {
    const data = {
      organizationId,
      courseId: session.courseId,
      campusId: session.campusId,
      classroomId: session.classroomId,
      teacherId: session.teacherId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      capacity: session.capacity,
      status: session.status,
      bookingOpensAt: session.bookingOpensAt,
      bookingClosesAt: session.bookingClosesAt,
      cancelDeadlineAt: session.cancelDeadlineAt,
    };
    try {
      await this.client.courseSession.upsert({
        where: { id: session.id },
        create: { id: session.id, ...data },
        update: data,
      });
    } catch (error) {
      if (this.isExclusionViolation(error)) {
        throw new DomainError(
          "SESSION_CONFLICT",
          "老师或教室在该时段已被占用",
          409,
        );
      }
      throw error;
    }
  }

  async getStudent(
    organizationId: string,
    id: string,
  ): Promise<Student | undefined> {
    const row = await this.client.student.findFirst({
      where: { id, organizationId },
      include: {
        guardianLinks: {
          take: 1,
          include: { guardian: { select: { phone: true } } },
        },
      },
    });
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      guardianPhone: row.guardianLinks[0]?.guardian.phone ?? "",
    };
  }

  async listBookings(organizationId: string): Promise<Booking[]> {
    const rows = await this.client.booking.findMany({ where: { organizationId } });
    return rows.map((row) => this.toBooking(row));
  }

  async getBooking(
    organizationId: string,
    id: string,
  ): Promise<Booking | undefined> {
    const row = await this.client.booking.findFirst({
      where: { id, organizationId },
    });
    return row ? this.toBooking(row) : undefined;
  }

  async findBooking(
    organizationId: string,
    sessionId: string,
    studentId: string,
  ): Promise<Booking | undefined> {
    const row = await this.client.booking.findUnique({
      where: {
        organizationId_sessionId_studentId: {
          organizationId,
          sessionId,
          studentId,
        },
      },
    });
    return row ? this.toBooking(row) : undefined;
  }

  async saveBooking(
    organizationId: string,
    booking: Booking,
  ): Promise<void> {
    await this.client.booking.upsert({
      where: { id: booking.id },
      create: { ...booking, organizationId },
      update: {
        status: booking.status,
        createdAt: booking.createdAt,
      },
    });
  }

  async listGuardianIdsByStudentIds(
    organizationId: string,
    studentIds: string[],
  ): Promise<string[]> {
    if (studentIds.length === 0) return [];
    const rows = await this.client.studentGuardian.findMany({
      where: { organizationId, studentId: { in: studentIds } },
      distinct: ["guardianId"],
      select: { guardianId: true },
    });
    return rows.map((row) => row.guardianId);
  }

  async saveNotification(
    organizationId: string,
    notification: Notification,
  ): Promise<void> {
    await this.client.notification.upsert({
      where: { id: notification.id },
      create: { ...notification, organizationId },
      update: {
        type: notification.type,
        title: notification.title,
        content: notification.content,
        sessionId: notification.sessionId,
        readAt: notification.readAt,
      },
    });
  }

  async listNotifications(
    organizationId: string,
    userId: string,
    unreadOnly = false,
  ): Promise<Notification[]> {
    const rows = await this.client.notification.findMany({
      where: {
        organizationId,
        userId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toNotification(row));
  }

  async getNotification(
    organizationId: string,
    id: string,
  ): Promise<Notification | undefined> {
    const row = await this.client.notification.findFirst({
      where: { organizationId, id },
    });
    return row ? this.toNotification(row) : undefined;
  }

  async saveAuditLog(organizationId: string, auditLog: AuditLog): Promise<void> {
    await this.client.auditLog.create({
      data: {
        ...auditLog,
        organizationId,
        details: auditLog.details as Prisma.InputJsonValue,
      },
    });
  }

  async listAuditLogs(organizationId: string): Promise<AuditLog[]> {
    const rows = await this.client.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      details: row.details,
      createdAt: row.createdAt,
    }));
  }

  async withSessionLock<T>(
    organizationId: string,
    sessionId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "CourseSession"
                     WHERE "organizationId" = ${organizationId}
                       AND "id" = ${sessionId}
                     FOR UPDATE`,
        );
        return this.transactions.run(transaction, action);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private get client(): PrismaClient | Prisma.TransactionClient {
    return this.transactions.getStore() ?? this.prisma;
  }

  private toSession(row: SessionRow): CourseSession {
    return {
      id: row.id,
      courseId: row.courseId,
      courseName: row.course.name,
      campusId: row.campusId,
      campusName: row.campus.name,
      classroomId: row.classroomId,
      classroomName: row.classroom?.name ?? null,
      teacherId: row.teacherId,
      teacherName: row.teacher.name,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      capacity: row.capacity,
      status: row.status,
      bookingOpensAt: row.bookingOpensAt,
      bookingClosesAt: row.bookingClosesAt,
      cancelDeadlineAt: row.cancelDeadlineAt,
    };
  }

  private toBooking(row: PrismaBooking): Booking {
    return {
      id: row.id,
      sessionId: row.sessionId,
      studentId: row.studentId,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  private toNotification(row: PrismaNotification): Notification {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      title: row.title,
      content: row.content,
      sessionId: row.sessionId,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }

  private isExclusionViolation(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
      error.message.includes("23P01") ||
      error.message.includes("CourseSession_teacher_time_excl") ||
      error.message.includes("CourseSession_classroom_time_excl")
    );
  }
}
