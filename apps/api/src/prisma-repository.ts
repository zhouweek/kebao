import { AsyncLocalStorage } from "node:async_hooks";
import {
  Prisma,
  PrismaClient,
  type Booking as PrismaBooking,
  type CourseSession as PrismaSession,
  type Notification as PrismaNotification,
  type NotificationDelivery as PrismaNotificationDelivery,
} from "@prisma/client";
import {
  type AdminBookingFilter,
  type AdminBookingPage,
  type AuditLog,
  DomainError,
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

  async listOrganizationIds(): Promise<string[]> {
    return (await this.client.organization.findMany({ select: { id: true } }))
      .map((item) => item.id);
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

  async findAuthUserByOrganizationCodeAndPhone(
    organizationCode: string,
    phone: string,
    role?: AuthUser["role"],
  ): Promise<AuthUser | undefined> {
    const user = await this.client.user.findFirst({
      where: {
        organization: { code: organizationCode },
        phone,
        ...(role ? { role } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        role: true,
        name: true,
        phone: true,
        passwordHash: true,
        wechatOpenId: true,
        isActive: true,
      },
    });
    return user ?? undefined;
  }

  async getAuthUser(
    userId: string,
    organizationId: string,
  ): Promise<AuthUser | undefined> {
    const user = await this.client.user.findFirst({
      where: { id: userId, organizationId },
      select: {
        id: true,
        organizationId: true,
        role: true,
        name: true,
        phone: true,
        passwordHash: true,
        wechatOpenId: true,
        isActive: true,
      },
    });
    return user ?? undefined;
  }

  async bindWechatOpenId(
    userId: string,
    organizationId: string,
    openId: string,
  ): Promise<void> {
    try {
      await this.client.user.update({
        where: { id: userId, organizationId },
        data: { wechatOpenId: openId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new DomainError(
          "WECHAT_IDENTITY_MISMATCH",
          "该微信身份已绑定机构内其他用户",
          401,
        );
      }
      throw error;
    }
  }

  async createAuthSession(session: AuthSession): Promise<void> {
    await this.client.authSession.create({ data: session });
  }

  async getAuthSessionById(id: string): Promise<AuthSession | undefined> {
    const session = await this.client.authSession.findUnique({ where: { id } });
    return session ?? undefined;
  }

  async getAuthSessionByRefreshTokenHash(hash: string): Promise<AuthSession | undefined> {
    const session = await this.client.authSession.findUnique({
      where: { refreshTokenHash: hash },
    });
    return session ?? undefined;
  }

  async rotateAuthSession(
    id: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.client.authSession.update({
      where: { id },
      data: { refreshTokenHash, expiresAt },
    });
  }

  async revokeAuthSession(id: string): Promise<void> {
    await this.client.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async touchUserLastLogin(
    userId: string,
    organizationId: string,
    at: Date,
  ): Promise<void> {
    await this.client.user.update({
      where: { id: userId, organizationId },
      data: { lastLoginAt: at },
    });
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

  async listMasterData(
    organizationId: string,
    resource: MasterResource,
    query: MasterDataQuery,
  ): Promise<MasterDataPage> {
    const skip = (query.page - 1) * query.pageSize;
    const active = query.activeOnly === undefined ? {} : { isActive: query.activeOnly };
    if (resource === "campuses") {
      const where: Prisma.CampusWhereInput = {
        organizationId,
        ...active,
        ...(query.keyword
          ? { OR: [{ name: { contains: query.keyword, mode: "insensitive" } }, { address: { contains: query.keyword, mode: "insensitive" } }] }
          : {}),
      };
      const [rows, total] = await Promise.all([
        this.client.campus.findMany({ where, skip, take: query.pageSize, orderBy: { createdAt: "desc" } }),
        this.client.campus.count({ where }),
      ]);
      return { items: rows, page: query.page, pageSize: query.pageSize, total };
    }
    if (resource === "classrooms") {
      const where: Prisma.ClassroomWhereInput = {
        organizationId,
        ...active,
        ...(query.campusId ? { campusId: query.campusId } : {}),
        ...(query.keyword
          ? { OR: [{ name: { contains: query.keyword, mode: "insensitive" } }, { code: { contains: query.keyword, mode: "insensitive" } }] }
          : {}),
      };
      const [rows, total] = await Promise.all([
        this.client.classroom.findMany({
          where,
          skip,
          take: query.pageSize,
          orderBy: { createdAt: "desc" },
          include: { campus: { select: { name: true } } },
        }),
        this.client.classroom.count({ where }),
      ]);
      return {
        items: rows.map(({ campus, ...row }) => ({ ...row, campusName: campus.name })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    }
    if (resource === "courses") {
      const where: Prisma.CourseWhereInput = {
        organizationId,
        ...active,
        ...(query.keyword
          ? { OR: [{ name: { contains: query.keyword, mode: "insensitive" } }, { code: { contains: query.keyword, mode: "insensitive" } }] }
          : {}),
      };
      const [rows, total] = await Promise.all([
        this.client.course.findMany({ where, skip, take: query.pageSize, orderBy: { createdAt: "desc" } }),
        this.client.course.count({ where }),
      ]);
      return { items: rows, page: query.page, pageSize: query.pageSize, total };
    }
    if (resource === "teachers" || resource === "guardians") {
      const role = resource === "teachers" ? "TEACHER" : "GUARDIAN";
      const where: Prisma.UserWhereInput = {
        organizationId,
        role,
        ...active,
        ...(query.keyword
          ? {
              OR: [
                { name: { contains: query.keyword, mode: "insensitive" } },
                { phone: { contains: query.keyword, mode: "insensitive" } },
                { email: { contains: query.keyword, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const select = {
        id: true,
        name: true,
        phone: true,
        email: true,
        specialty: true,
        remark: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      } satisfies Prisma.UserSelect;
      const [rows, total] = await Promise.all([
        this.client.user.findMany({ where, select, skip, take: query.pageSize, orderBy: { createdAt: "desc" } }),
        this.client.user.count({ where }),
      ]);
      return { items: rows, page: query.page, pageSize: query.pageSize, total };
    }
    const where: Prisma.StudentWhereInput = {
      organizationId,
      ...active,
      ...(query.campusId ? { campusId: query.campusId } : {}),
      ...(query.keyword
        ? { OR: [{ name: { contains: query.keyword, mode: "insensitive" } }, { phone: { contains: query.keyword, mode: "insensitive" } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.client.student.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          campus: { select: { name: true } },
          guardianLinks: {
            include: { guardian: { select: { id: true, name: true, phone: true } } },
          },
        },
      }),
      this.client.student.count({ where }),
    ]);
    return {
      items: rows.map(({ campus, guardianLinks, ...row }) => ({
        ...row,
        campusName: campus?.name ?? null,
        guardians: guardianLinks.map((link) => ({
          ...link.guardian,
          relationship: link.relationship,
          isPrimary: link.isPrimary,
        })),
      })),
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
    try {
      return await this.requireMasterData(organizationId, resource, id);
    } catch (error) {
      if (error instanceof DomainError && error.code === "MASTER_DATA_NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }

  async createMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
    input: Record<string, unknown>,
  ): Promise<MasterDataItem> {
    await this.validateMasterReferences(organizationId, resource, input);
    try {
      if (resource === "campuses") {
        return await this.client.campus.create({
          data: {
            id,
            organizationId,
            ...(input as Omit<Prisma.CampusUncheckedCreateInput, "id" | "organizationId">),
          },
        });
      }
      if (resource === "classrooms") {
        const row = await this.client.classroom.create({
          data: { id, organizationId, ...(input as Omit<Prisma.ClassroomUncheckedCreateInput, "id" | "organizationId">) },
          include: { campus: { select: { name: true } } },
        });
        return { ...row, campusName: row.campus.name };
      }
      if (resource === "courses") {
        return await this.client.course.create({
          data: {
            id,
            organizationId,
            ...(input as Omit<Prisma.CourseUncheckedCreateInput, "id" | "organizationId">),
          },
        });
      }
      if (resource === "teachers" || resource === "guardians") {
        return await this.client.user.create({
          data: {
            id,
            organizationId,
            role: resource === "teachers" ? "TEACHER" : "GUARDIAN",
            ...(input as Omit<Prisma.UserUncheckedCreateInput, "id" | "organizationId" | "role">),
          },
          select: {
            id: true, name: true, phone: true, email: true, specialty: true,
            remark: true, isActive: true, createdAt: true, updatedAt: true,
          },
        });
      }
      const studentInput = input as Omit<
        Prisma.StudentUncheckedCreateInput,
        "id" | "organizationId" | "birthDate"
      >;
      const row = await this.client.student.create({
        data: {
          id,
          organizationId,
          ...studentInput,
          ...(input.birthDate ? { birthDate: new Date(String(input.birthDate)) } : {}),
        },
        include: { campus: { select: { name: true } } },
      });
      return { ...row, campusName: row.campus?.name ?? null, guardians: [] };
    } catch (error) {
      this.throwMasterDataError(error);
    }
  }

  async updateMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
    input: Record<string, unknown>,
  ): Promise<MasterDataItem> {
    await this.requireMasterData(organizationId, resource, id);
    await this.validateMasterReferences(organizationId, resource, input);
    try {
      if (resource === "campuses") {
        return await this.client.campus.update({
          where: { id_organizationId: { id, organizationId } },
          data: input as Prisma.CampusUpdateInput,
        });
      }
      if (resource === "classrooms") {
        const row = await this.client.classroom.update({
          where: { id_organizationId: { id, organizationId } },
          data: input as Prisma.ClassroomUncheckedUpdateInput,
          include: { campus: { select: { name: true } } },
        });
        return { ...row, campusName: row.campus.name };
      }
      if (resource === "courses") {
        return await this.client.course.update({
          where: { id_organizationId: { id, organizationId } },
          data: input as Prisma.CourseUpdateInput,
        });
      }
      if (resource === "teachers" || resource === "guardians") {
        return await this.client.user.update({
          where: { id_organizationId: { id, organizationId } },
          data: input as Prisma.UserUpdateInput,
          select: {
            id: true, name: true, phone: true, email: true, specialty: true,
            remark: true, isActive: true, createdAt: true, updatedAt: true,
          },
        });
      }
      const data = { ...input, birthDate: input.birthDate ? new Date(String(input.birthDate)) : input.birthDate };
      const row = await this.client.student.update({
        where: { id_organizationId: { id, organizationId } },
        data: data as Prisma.StudentUncheckedUpdateInput,
        include: {
          campus: { select: { name: true } },
          guardianLinks: { include: { guardian: { select: { id: true, name: true, phone: true } } } },
        },
      });
      return {
        ...row,
        campusName: row.campus?.name ?? null,
        guardians: row.guardianLinks.map((link) => ({
          ...link.guardian, relationship: link.relationship, isPrimary: link.isPrimary,
        })),
      };
    } catch (error) {
      this.throwMasterDataError(error);
    }
  }

  async setMasterDataActive(
    organizationId: string,
    resource: MasterResource,
    id: string,
    isActive: boolean,
  ): Promise<MasterDataItem> {
    const current = await this.requireMasterData(organizationId, resource, id);
    return this.updateMasterData(organizationId, resource, id, {
      ...this.editableMasterData(current),
      isActive,
    });
  }

  async deleteMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
  ): Promise<void> {
    await this.requireMasterData(organizationId, resource, id);
    try {
      const where = { id_organizationId: { id, organizationId } };
      if (resource === "campuses") await this.client.campus.delete({ where });
      else if (resource === "classrooms") await this.client.classroom.delete({ where });
      else if (resource === "courses") await this.client.course.delete({ where });
      else if (resource === "students") await this.client.student.delete({ where });
      else await this.client.user.delete({ where });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new DomainError("MASTER_DATA_IN_USE", "资料已被业务数据使用，请改为停用", 409);
      }
      throw error;
    }
  }

  async setStudentGuardians(
    organizationId: string,
    studentId: string,
    links: Array<{ guardianId: string; relationship: string; isPrimary: boolean }>,
  ): Promise<MasterDataItem> {
    await this.requireMasterData(organizationId, "students", studentId);
    const guardianIds = [...new Set(links.map((link) => link.guardianId))];
    if (guardianIds.length !== links.length) {
      throw new DomainError("VALIDATION_ERROR", "监护人列表包含重复项", 400);
    }
    const count = await this.client.user.count({
      where: { organizationId, role: "GUARDIAN", id: { in: guardianIds } },
    });
    if (count !== guardianIds.length) {
      throw new DomainError("GUARDIAN_NOT_FOUND", "监护人不存在或不属于当前机构", 404);
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.studentGuardian.deleteMany({ where: { organizationId, studentId } });
      if (links.length) {
        await transaction.studentGuardian.createMany({
          data: links.map((link) => ({ organizationId, studentId, ...link })),
        });
      }
    });
    const student = await this.client.student.findFirst({
      where: { id: studentId, organizationId },
      include: {
        campus: { select: { name: true } },
        guardianLinks: { include: { guardian: { select: { id: true, name: true, phone: true } } } },
      },
    });
    return {
      ...student!,
      campusName: student!.campus?.name ?? null,
      guardians: student!.guardianLinks.map((link) => ({
        ...link.guardian, relationship: link.relationship, isPrimary: link.isPrimary,
      })),
    };
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
        ...(filter.courseId ? { courseId: filter.courseId } : {}),
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
      seriesId: session.seriesId ?? null,
      occurrenceIndex: session.occurrenceIndex ?? null,
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

  async getSeries(
    organizationId: string,
    id: string,
  ): Promise<ScheduleSeries | undefined> {
    const row = await this.client.scheduleSeries.findFirst({
      where: { id, organizationId },
    });
    return row
      ? {
          id: row.id,
          recurrence: "WEEKLY",
          intervalWeeks: row.intervalWeeks,
          requestedCount: row.requestedCount,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
        }
      : undefined;
  }

  async saveSeries(organizationId: string, series: ScheduleSeries): Promise<void> {
    await this.client.scheduleSeries.upsert({
      where: { id: series.id },
      create: { ...series, organizationId },
      update: {
        intervalWeeks: series.intervalWeeks,
        requestedCount: series.requestedCount,
      },
    });
  }

  async listSeriesSessions(
    organizationId: string,
    seriesId: string,
  ): Promise<CourseSession[]> {
    const rows = await this.client.courseSession.findMany({
      where: { organizationId, seriesId },
      include: sessionInclude,
      orderBy: { occurrenceIndex: "asc" },
    });
    return rows.map((row) => this.toSession(row));
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

  async listAdminBookings(
    organizationId: string,
    filter: AdminBookingFilter,
  ): Promise<AdminBookingPage> {
    const where: Prisma.BookingWhereInput = {
      organizationId,
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? {
            session: {
              startsAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lt: filter.to } : {}),
              },
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.client.booking.findMany({
        where,
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          session: {
            select: {
              id: true,
              courseId: true,
              startsAt: true,
              endsAt: true,
              status: true,
              course: { select: { name: true } },
              teacher: { select: { id: true, name: true } },
            },
          },
          student: {
            include: {
              guardianLinks: {
                orderBy: { isPrimary: "desc" },
                take: 1,
                include: { guardian: { select: { phone: true } } },
              },
            },
          },
        },
      }),
      this.client.booking.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        ...this.toBooking(row),
        session: {
          id: row.session.id,
          courseId: row.session.courseId,
          courseName: row.session.course.name,
          startsAt: row.session.startsAt,
          endsAt: row.session.endsAt,
          status: row.session.status,
        },
        student: {
          id: row.student.id,
          name: row.student.name,
          guardianPhone: row.student.guardianLinks[0]?.guardian.phone ?? "",
        },
        teacher: row.session.teacher,
      })),
      page: filter.page,
      pageSize: filter.pageSize,
      total,
    };
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
        idempotencyKey: notification.idempotencyKey ?? null,
        readAt: notification.readAt,
      },
    });
  }

  async saveNotificationWithDelivery(
    organizationId: string,
    notification: Notification,
    delivery: NotificationDelivery,
  ): Promise<boolean> {
    return this.withTransaction(async () => {
      const saved = await this.client.notification.createMany({
        data: [{ ...notification, organizationId }],
        skipDuplicates: true,
      });
      if (!saved.count) return false;
        await this.client.notificationDelivery.create({
          data: {
            ...delivery,
            notificationId: notification.id,
            organizationId,
            payload: delivery.payload as Prisma.InputJsonValue,
          },
        });
      return true;
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

  async getUserWechatOpenId(
    organizationId: string,
    userId: string,
  ): Promise<string | null> {
    return (
      await this.client.user.findFirst({
        where: { id: userId, organizationId },
        select: { wechatOpenId: true },
      })
    )?.wechatOpenId ?? null;
  }

  async listDueNotificationDeliveries(
    now: Date,
    limit: number,
  ): Promise<Array<NotificationDelivery & { organizationId: string }>> {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const rows = await this.client.notificationDelivery.findMany({
      where: {
        OR: [
          {
            status: { in: ["PENDING", "FAILED"] },
            nextAttemptAt: { lte: now },
          },
          { status: "SENDING", updatedAt: { lte: staleBefore } },
        ],
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    });
    return rows.map((row) => ({ ...this.toDelivery(row), organizationId: row.organizationId }));
  }

  async claimNotificationDelivery(
    id: string,
    now: Date,
  ): Promise<NotificationDelivery | undefined> {
    const staleBefore = new Date(now.getTime() - 5 * 60_000);
    const result = await this.client.notificationDelivery.updateMany({
      where: {
        id,
        OR: [
          {
            status: { in: ["PENDING", "FAILED"] },
            nextAttemptAt: { lte: now },
          },
          { status: "SENDING", updatedAt: { lte: staleBefore } },
        ],
      },
      data: { status: "SENDING", updatedAt: now },
    });
    if (!result.count) return undefined;
    const row = await this.client.notificationDelivery.findUnique({ where: { id } });
    return row ? this.toDelivery(row) : undefined;
  }

  async saveNotificationDelivery(
    organizationId: string,
    delivery: NotificationDelivery,
  ): Promise<void> {
    await this.client.notificationDelivery.update({
      where: { id_organizationId: { id: delivery.id, organizationId } },
      data: {
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        lastError: delivery.lastError,
        nextAttemptAt: delivery.nextAttemptAt,
        sentAt: delivery.sentAt,
        updatedAt: delivery.updatedAt,
      },
    });
  }

  async getNotificationDelivery(
    organizationId: string,
    id: string,
  ): Promise<NotificationDelivery | undefined> {
    const row = await this.client.notificationDelivery.findFirst({
      where: { id, organizationId },
    });
    return row ? this.toDelivery(row) : undefined;
  }

  async listAdminNotificationDeliveries(
    organizationId: string,
    limit: number,
  ): Promise<AdminNotificationDelivery[]> {
    const rows = await this.client.notificationDelivery.findMany({
      where: { organizationId },
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        notification: {
          select: { title: true, content: true, type: true, createdAt: true },
        },
        user: { select: { id: true, name: true, wechatOpenId: true } },
      },
    });
    return rows.map((row) => ({
      ...this.toDelivery(row),
      notification: row.notification,
      user: row.user,
    }));
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

  async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.transactions.getStore()) return action();
    return this.prisma.$transaction(
      (transaction) => this.transactions.run(transaction, action),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private get client(): PrismaClient | Prisma.TransactionClient {
    return this.transactions.getStore() ?? this.prisma;
  }

  private async requireMasterData(
    organizationId: string,
    resource: MasterResource,
    id: string,
  ): Promise<MasterDataItem> {
    let item: { id: string; name: string; isActive: boolean; createdAt: Date; updatedAt: Date } | null;
    if (resource === "campuses") {
      item = await this.client.campus.findFirst({ where: { id, organizationId } });
    } else if (resource === "classrooms") {
      item = await this.client.classroom.findFirst({ where: { id, organizationId } });
    } else if (resource === "courses") {
      item = await this.client.course.findFirst({ where: { id, organizationId } });
    } else if (resource === "students") {
      item = await this.client.student.findFirst({ where: { id, organizationId } });
    } else {
      item = await this.client.user.findFirst({
        where: {
          id,
          organizationId,
          role: resource === "teachers" ? "TEACHER" : "GUARDIAN",
        },
      });
    }
    if (!item) {
      throw new DomainError("MASTER_DATA_NOT_FOUND", "基础资料不存在", 404);
    }
    return item;
  }

  private async validateMasterReferences(
    organizationId: string,
    resource: MasterResource,
    input: Record<string, unknown>,
  ): Promise<void> {
    if ((resource === "classrooms" || resource === "students") && input.campusId) {
      const exists = await this.client.campus.count({
        where: { id: String(input.campusId), organizationId },
      });
      if (!exists) {
        throw new DomainError("CAMPUS_NOT_FOUND", "所属校区不存在", 404);
      }
    }
  }

  private editableMasterData(item: MasterDataItem): Record<string, unknown> {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      guardians: _guardians,
      campusName: _campusName,
      ...editable
    } = item;
    return editable;
  }

  private throwMasterDataError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainError("MASTER_DATA_DUPLICATE", "同一机构内已存在相同名称、编码或联系方式", 409);
    }
    throw error;
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
      seriesId: row.seriesId,
      occurrenceIndex: row.occurrenceIndex,
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
      idempotencyKey: row.idempotencyKey,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }

  private toDelivery(row: PrismaNotificationDelivery): NotificationDelivery {
    return {
      id: row.id,
      notificationId: row.notificationId,
      userId: row.userId,
      channel: "WECHAT",
      status: row.status,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      idempotencyKey: row.idempotencyKey,
      payload: row.payload as unknown as NotificationDelivery["payload"],
      nextAttemptAt: row.nextAttemptAt,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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
