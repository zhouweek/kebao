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

type SessionRow = PrismaSession & {
  course: { name: string };
  campus: { name: string };
  classroom: { name: string } | null;
  teacher: { name: string };
};

const TRANSACTION_MAX_ATTEMPTS = 3;

const sessionInclude = {
  course: { select: { name: true } },
  campus: { select: { name: true } },
  classroom: { select: { name: true } },
  teacher: { select: { name: true } },
} satisfies Prisma.CourseSessionInclude;

export class PrismaRepository implements Repository, PlatformRepository {
  private readonly transactions = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(private readonly prisma: PrismaClient) {}

  async organizationExists(organizationId: string): Promise<boolean> {
    return (
      (await this.client.organization.count({ where: { id: organizationId } })) === 1
    );
  }

  async isOrganizationActive(organizationId: string): Promise<boolean> {
    return (
      (await this.client.organization.count({
        where: { id: organizationId, isActive: true, deletedAt: null },
      })) === 1
    );
  }

  async listOrganizationIds(): Promise<string[]> {
    return (
      await this.client.organization.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
      })
    )
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
        mustChangePassword: true,
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
        mustChangePassword: true,
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
    expectedHash: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.client.authSession.updateMany({
      where: {
        id,
        refreshTokenHash: expectedHash,
        revokedAt: null,
      },
      data: { refreshTokenHash, expiresAt },
    });
    return result.count === 1;
  }

  async revokeAuthSession(id: string): Promise<void> {
    await this.client.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string, organizationId: string): Promise<void> {
    await this.client.authSession.updateMany({
      where: { userId, organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async updateUserPassword(
    userId: string,
    organizationId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<boolean> {
    const result = await this.client.user.updateMany({
      where: { id: userId, organizationId, passwordHash: expectedPasswordHash },
      data: { passwordHash, mustChangePassword },
    });
    return result.count === 1;
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

  async findPlatformAccount(username: string): Promise<PlatformAccount | undefined> {
    return (
      (await this.client.platformAccount.findUnique({ where: { username } })) ?? undefined
    );
  }

  async getPlatformAccount(id: string): Promise<PlatformAccount | undefined> {
    return (await this.client.platformAccount.findUnique({ where: { id } })) ?? undefined;
  }

  async createPlatformSession(session: PlatformSession): Promise<void> {
    await this.client.platformSession.create({ data: session });
  }

  async getPlatformSessionById(id: string): Promise<PlatformSession | undefined> {
    return (await this.client.platformSession.findUnique({ where: { id } })) ?? undefined;
  }

  async getPlatformSessionByRefreshTokenHash(hash: string): Promise<PlatformSession | undefined> {
    return (
      (await this.client.platformSession.findUnique({ where: { refreshTokenHash: hash } })) ??
      undefined
    );
  }

  async rotatePlatformSession(
    id: string,
    expectedHash: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.client.platformSession.updateMany({
      where: {
        id,
        refreshTokenHash: expectedHash,
        revokedAt: null,
      },
      data: { refreshTokenHash, expiresAt },
    });
    return result.count === 1;
  }

  async revokePlatformSession(id: string): Promise<void> {
    await this.client.platformSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllPlatformSessions(accountId: string): Promise<void> {
    await this.client.platformSession.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async touchPlatformLastLogin(accountId: string, at: Date): Promise<void> {
    await this.client.platformAccount.update({ where: { id: accountId }, data: { lastLoginAt: at } });
  }

  async updatePlatformPassword(
    accountId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<boolean> {
    const result = await this.client.platformAccount.updateMany({
      where: { id: accountId, passwordHash: expectedPasswordHash },
      data: { passwordHash, mustChangePassword },
    });
    return result.count === 1;
  }

  async listPlatformOrganizations(includeDeleted = false): Promise<PlatformOrganization[]> {
    return this.client.organization.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async getPlatformOrganization(
    id: string,
    includeDeleted = false,
  ): Promise<PlatformOrganization | undefined> {
    return (
      (await this.client.organization.findFirst({
        where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
      })) ?? undefined
    );
  }

  async createPlatformOrganization(input: {
    id: string;
    code: string;
    name: string;
  }): Promise<PlatformOrganization> {
    try {
      return await this.client.organization.create({
        data: { ...input, code: input.code.trim().toUpperCase() },
      });
    } catch (error) {
      this.throwPlatformConflict(error);
    }
  }

  async updatePlatformOrganization(
    id: string,
    input: { code?: string; name?: string },
  ): Promise<PlatformOrganization> {
    await this.requirePlatformOrganization(id);
    try {
      return await this.client.organization.update({
        where: { id },
        data: {
          ...input,
          ...(input.code === undefined
            ? {}
            : { code: input.code.trim().toUpperCase() }),
        },
      });
    } catch (error) {
      this.throwPlatformConflict(error);
    }
  }

  async setPlatformOrganizationActive(id: string, isActive: boolean): Promise<PlatformOrganization> {
    await this.requirePlatformOrganization(id);
    const organization = await this.client.organization.update({
      where: { id },
      data: { isActive },
    });
    if (!isActive) {
      await this.client.authSession.updateMany({
        where: { organizationId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return organization;
  }

  async softDeletePlatformOrganization(id: string): Promise<void> {
    await this.requirePlatformOrganization(id);
    const now = new Date();
    await this.client.organization.update({
      where: { id },
      data: { isActive: false, deletedAt: now },
    });
    await this.client.authSession.updateMany({
      where: { organizationId: id, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async listPlatformTenantAdmins(organizationId: string): Promise<PlatformTenantAdmin[]> {
    await this.requirePlatformOrganization(organizationId);
    return this.client.user.findMany({
      where: { organizationId, role: "ADMIN" },
      select: {
        id: true, organizationId: true, name: true, phone: true, email: true,
        isActive: true, mustChangePassword: true, lastLoginAt: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createPlatformTenantAdmin(input: {
    id: string;
    organizationId: string;
    name: string;
    phone: string;
    email?: string | null;
    passwordHash: string;
  }): Promise<PlatformTenantAdmin> {
    await this.requirePlatformOrganization(input.organizationId);
    try {
      return await this.client.user.create({
        data: { ...input, role: "ADMIN", mustChangePassword: true },
        select: {
          id: true, organizationId: true, name: true, phone: true, email: true,
          isActive: true, mustChangePassword: true, lastLoginAt: true,
          createdAt: true, updatedAt: true,
        },
      });
    } catch (error) {
      this.throwPlatformConflict(error);
    }
  }

  async updatePlatformTenantAdmin(
    organizationId: string,
    userId: string,
    input: { name?: string; phone?: string; email?: string | null },
  ): Promise<PlatformTenantAdmin> {
    await this.requireTenantAdmin(organizationId, userId);
    try {
      return await this.client.user.update({
        where: { id_organizationId: { id: userId, organizationId } },
        data: input,
        select: {
          id: true, organizationId: true, name: true, phone: true, email: true,
          isActive: true, mustChangePassword: true, lastLoginAt: true,
          createdAt: true, updatedAt: true,
        },
      });
    } catch (error) {
      this.throwPlatformConflict(error);
    }
  }

  async setPlatformTenantAdminActive(
    organizationId: string,
    userId: string,
    isActive: boolean,
  ): Promise<PlatformTenantAdmin> {
    await this.requireTenantAdmin(organizationId, userId);
    const user = await this.client.user.update({
      where: { id_organizationId: { id: userId, organizationId } },
      data: { isActive },
      select: {
        id: true, organizationId: true, name: true, phone: true, email: true,
        isActive: true, mustChangePassword: true, lastLoginAt: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!isActive) await this.revokeTenantUserSessions(organizationId, userId);
    return user;
  }

  async resetPlatformTenantAdminPassword(
    organizationId: string,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.requireTenantAdmin(organizationId, userId);
    await this.client.user.update({
      where: { id_organizationId: { id: userId, organizationId } },
      data: { passwordHash, mustChangePassword: true },
    });
    await this.revokeTenantUserSessions(organizationId, userId);
  }

  async revokeTenantUserSessions(organizationId: string, userId: string): Promise<void> {
    await this.revokeAllUserSessions(userId, organizationId);
  }

  async savePlatformAudit(log: PlatformAudit): Promise<void> {
    await this.client.platformAuditLog.create({
      data: { ...log, details: log.details as Prisma.InputJsonValue },
    });
  }

  async listPlatformAudits(limit: number): Promise<PlatformAudit[]> {
    return this.client.platformAuditLog.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
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

  async listGuardianStudents(
    organizationId: string,
    guardianId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.client.student.findMany({
      where: {
        organizationId,
        isActive: true,
        guardianLinks: { some: { guardianId } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
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

  async listCoursePackages(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<CoursePackageListItem>> {
    const offset = coursePackagePageOffset(query);
    const where: Prisma.CoursePackageWhereInput = {
      organizationId,
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.status ? { status: query.status as CoursePackage["status"] } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: "insensitive" } },
              { description: { contains: query.keyword, mode: "insensitive" } },
              { course: { name: { contains: query.keyword, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const total = await this.client.coursePackage.count({ where });
    if (offset >= total) {
      return { items: [], page: query.page, pageSize: query.pageSize, total };
    }
    const rows = await this.client.coursePackage.findMany({
      where,
      skip: offset,
      take: query.pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        course: { select: { name: true } },
        _count: { select: { purchases: { where: { status: "PAID" } } } },
      },
    });
    return {
      items: rows.map(({ course, _count, organizationId: _organizationId, ...row }) => ({
        ...row,
        courseName: course.name,
        soldCount: _count.purchases,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getCoursePackage(
    organizationId: string,
    id: string,
  ): Promise<CoursePackageListItem | undefined> {
    const row = await this.client.coursePackage.findFirst({
      where: { id, organizationId },
      include: {
        course: { select: { name: true } },
        _count: { select: { purchases: { where: { status: "PAID" } } } },
      },
    });
    if (!row) return undefined;
    const { course, _count, organizationId: _organizationId, ...item } = row;
    return { ...item, courseName: course.name, soldCount: _count.purchases };
  }

  async saveCoursePackage(
    organizationId: string,
    item: CoursePackage,
    expectedVersion?: number,
  ): Promise<boolean> {
    const data = {
      version: item.version,
      courseId: item.courseId,
      name: item.name,
      description: item.description,
      creditCount: item.creditCount,
      validityMonths: item.validityMonths,
      priceCents: item.priceCents,
      absentDeductsCredit: item.absentDeductsCredit,
      lateCancellationDeductsCredit: item.lateCancellationDeductsCredit,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    try {
      if (expectedVersion === undefined) {
        await this.client.coursePackage.create({
          data: { id: item.id, organizationId, ...data },
        });
        return true;
      }
      const updated = await this.client.coursePackage.updateMany({
        where: { id: item.id, organizationId, version: expectedVersion },
        data,
      });
      return updated.count === 1;
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new DomainError("COURSE_PACKAGE_DUPLICATE", "课包名称已存在", 409);
      }
      throw error;
    }
  }

  async findCoursePurchaseByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<CoursePurchaseListItem | undefined> {
    const row = await this.client.coursePurchase.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
      include: {
        student: { select: { name: true } },
        entitlement: { select: { id: true } },
      },
    });
    if (!row?.entitlement) return undefined;
    const {
      student,
      entitlement,
      organizationId: _organizationId,
      ...purchase
    } = row;
    return { ...purchase, studentName: student.name, entitlementId: entitlement.id };
  }

  async listCoursePurchases(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<CoursePurchaseListItem>> {
    const offset = coursePackagePageOffset(query);
    const where: Prisma.CoursePurchaseWhereInput = {
      organizationId,
      entitlement: { isNot: null },
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.status ? { status: query.status as CoursePurchase["status"] } : {}),
      ...(query.keyword
        ? {
            OR: [
              { packageNameSnapshot: { contains: query.keyword, mode: "insensitive" } },
              { courseNameSnapshot: { contains: query.keyword, mode: "insensitive" } },
              { student: { name: { contains: query.keyword, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const total = await this.client.coursePurchase.count({ where });
    if (offset >= total) {
      return { items: [], page: query.page, pageSize: query.pageSize, total };
    }
    const rows = await this.client.coursePurchase.findMany({
      where,
      skip: offset,
      take: query.pageSize,
      orderBy: [{ purchasedAt: "desc" }, { id: "desc" }],
      include: {
        student: { select: { name: true } },
        entitlement: { select: { id: true } },
      },
    });
    return {
      items: rows.flatMap(
        ({ student, entitlement, organizationId: _organizationId, ...purchase }) =>
          entitlement
            ? [{ ...purchase, studentName: student.name, entitlementId: entitlement.id }]
            : [],
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async saveCoursePurchase(organizationId: string, item: CoursePurchase): Promise<void> {
    try {
      await this.client.coursePurchase.create({ data: { ...item, organizationId } });
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new DomainError("IDEMPOTENCY_KEY_CONFLICT", "幂等键已用于其他购买请求", 409);
      }
      throw error;
    }
  }

  async listStudentEntitlements(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<EntitlementListItem>> {
    const offset = coursePackagePageOffset(query);
    const where: Prisma.StudentCourseEntitlementWhereInput = {
      organizationId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.status ? { status: query.status as StudentCourseEntitlement["status"] } : {}),
      ...(query.keyword
        ? {
            OR: [
              { student: { name: { contains: query.keyword, mode: "insensitive" } } },
              {
                purchase: {
                  packageNameSnapshot: { contains: query.keyword, mode: "insensitive" },
                },
              },
              {
                purchase: {
                  courseNameSnapshot: { contains: query.keyword, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const include = {
      student: { select: { name: true } },
      purchase: {
        select: {
          packageNameSnapshot: true,
          courseNameSnapshot: true,
        },
      },
    } satisfies Prisma.StudentCourseEntitlementInclude;
    const total = await this.client.studentCourseEntitlement.count({ where });
    if (offset >= total) {
      return { items: [], page: query.page, pageSize: query.pageSize, total };
    }
    const rows = await this.client.studentCourseEntitlement.findMany({
      where,
      skip: offset,
      take: query.pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include,
    });
    return {
      items: rows.map(({ student, purchase, organizationId: _organizationId, ...item }) => ({
        ...item,
        studentName: student.name,
        packageName: purchase.packageNameSnapshot,
        courseName: purchase.courseNameSnapshot,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getStudentEntitlement(
    organizationId: string,
    id: string,
  ): Promise<EntitlementListItem | undefined> {
    const row = await this.client.studentCourseEntitlement.findFirst({
      where: { id, organizationId },
      include: {
        student: { select: { name: true } },
        purchase: {
          select: {
            packageNameSnapshot: true,
            courseNameSnapshot: true,
          },
        },
      },
    });
    if (!row) return undefined;
    const {
      student,
      purchase,
      organizationId: _organizationId,
      ...item
    } = row;
    return {
      ...item,
      studentName: student.name,
      packageName: purchase.packageNameSnapshot,
      courseName: purchase.courseNameSnapshot,
    };
  }

  async saveStudentEntitlement(
    organizationId: string,
    item: StudentCourseEntitlement,
    expectedVersion?: number,
  ): Promise<boolean> {
    if (expectedVersion === undefined) {
      await this.client.studentCourseEntitlement.create({ data: { ...item, organizationId } });
      return true;
    }
    const updated = await this.client.studentCourseEntitlement.updateMany({
      where: { id: item.id, organizationId, version: expectedVersion },
      data: {
        remainingCredits: item.remainingCredits,
        reservedCredits: item.reservedCredits,
        version: item.version,
        validUntil: item.validUntil,
        status: item.status,
        updatedAt: item.updatedAt,
      },
    });
    return updated.count === 1;
  }

  async listUsableStudentEntitlements(
    organizationId: string,
    studentId: string,
    courseId: string,
    businessDate: Date,
  ): Promise<StudentCourseEntitlement[]> {
    const rows = await this.client.studentCourseEntitlement.findMany({
      where: {
        organizationId,
        studentId,
        courseId,
        status: "ACTIVE",
        validFrom: { lte: businessDate },
        validUntil: { gte: businessDate },
      },
      orderBy: [{ validUntil: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    return rows
      .filter((item) => item.remainingCredits > item.reservedCredits)
      .map(({ organizationId: _organizationId, ...item }) => item);
  }

  async getCoursePurchase(
    organizationId: string,
    id: string,
  ): Promise<CoursePurchase | undefined> {
    const row = await this.client.coursePurchase.findFirst({ where: { id, organizationId } });
    if (!row) return undefined;
    const { organizationId: _organizationId, ...item } = row;
    return item;
  }

  async getCreditReservationByBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<CreditReservation | undefined> {
    const row = await this.client.creditReservation.findUnique({
      where: { organizationId_bookingId: { organizationId, bookingId } },
    });
    if (!row) return undefined;
    const { organizationId: _organizationId, ...item } = row;
    return item;
  }

  async listExpiredCreditReservations(
    organizationId: string,
    expiresAt: Date,
    limit: number,
    excludedReservationIds: readonly string[] = [],
  ): Promise<CreditReservation[]> {
    const rows = await this.client.creditReservation.findMany({
      where: {
        organizationId,
        ...(excludedReservationIds.length > 0
          ? { id: { notIn: [...excludedReservationIds] } }
          : {}),
        status: "RESERVED",
        expiresAt: { lte: expiresAt },
        OR: [
          { nextSettlementAttemptAt: null },
          { nextSettlementAttemptAt: { lte: expiresAt } },
        ],
        booking: {
          status: "CONFIRMED",
          session: { endsAt: { lte: expiresAt } },
        },
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(({ organizationId: _organizationId, ...item }) => item);
  }

  async saveCreditReservation(
    organizationId: string,
    item: CreditReservation,
  ): Promise<void> {
    await this.client.creditReservation.upsert({
      where: { organizationId_bookingId: { organizationId, bookingId: item.bookingId } },
      create: { ...item, organizationId },
      update: {
        status: item.status,
        expiresAt: item.expiresAt,
        releasedAt: item.releasedAt,
        consumedAt: item.consumedAt,
        settlementAttemptCount: item.settlementAttemptCount,
        nextSettlementAttemptAt: item.nextSettlementAttemptAt,
        settlementLastError: item.settlementLastError,
        updatedAt: item.updatedAt,
      },
    });
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
    const result = await this.client.creditReservation.updateMany({
      where: {
        id: item.id,
        organizationId,
        status: "RESERVED",
        settlementAttemptCount: expectedAttemptCount,
      },
      data: {
        settlementAttemptCount: item.settlementAttemptCount,
        nextSettlementAttemptAt: item.nextSettlementAttemptAt,
        settlementLastError: item.settlementLastError,
        updatedAt: item.updatedAt,
      },
    });
    return result.count === 1;
  }

  async expireStudentEntitlements(
    organizationId: string,
    businessDate: Date,
    updatedAt: Date,
  ): Promise<void> {
    await this.client.studentCourseEntitlement.updateMany({
      where: {
        organizationId,
        status: "ACTIVE",
        validUntil: { lt: businessDate },
      },
      data: {
        status: "EXPIRED",
        version: { increment: 1 },
        updatedAt,
      },
    });
  }

  async listCreditLedgers(
    organizationId: string,
    entitlementId: string,
  ): Promise<CreditLedger[]> {
    const rows = await this.client.creditLedger.findMany({
      where: { organizationId, entitlementId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    return rows.map(({ organizationId: _organizationId, ...item }) => item);
  }

  async listCreditLedgerPage(
    organizationId: string,
    entitlementId: string,
    query: PageQuery,
  ): Promise<Page<CreditLedger>> {
    const offset = coursePackagePageOffset(query);
    const keyword = query.keyword?.trim();
    const matchingTypes = keyword ? creditLedgerTypesMatchingKeyword(keyword) : [];
    const where: Prisma.CreditLedgerWhereInput = {
      organizationId,
      entitlementId,
      ...(keyword
        ? {
            OR: [
              ...(matchingTypes.length ? [{ type: { in: matchingTypes } }] : []),
              { note: { contains: keyword, mode: "insensitive" as const } },
              { actorId: { contains: keyword, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const total = await this.client.creditLedger.count({ where });
    if (offset >= total) {
      return { items: [], page: query.page, pageSize: query.pageSize, total };
    }
    const rows = await this.client.creditLedger.findMany({
      where,
      skip: offset,
      take: query.pageSize,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    });
    return {
      items: rows.map(({ organizationId: _organizationId, ...item }) => item),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listBookingCreditLedgers(
    organizationId: string,
    bookingId: string,
  ): Promise<CreditLedger[]> {
    const rows = await this.client.creditLedger.findMany({
      where: { organizationId, bookingId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(({ organizationId: _organizationId, ...item }) => item);
  }

  async saveCreditLedger(organizationId: string, item: CreditLedger): Promise<void> {
    await this.client.creditLedger.create({ data: { ...item, organizationId } });
  }

  async listEntitlementValidityChanges(
    organizationId: string,
    entitlementId: string,
    query: PageQuery,
  ): Promise<Page<EntitlementValidityChange>> {
    const offset = coursePackagePageOffset(query);
    const where: Prisma.EntitlementValidityChangeWhereInput = {
      organizationId,
      entitlementId,
      ...(query.keyword?.trim()
        ? { reason: { contains: query.keyword.trim(), mode: "insensitive" } }
        : {}),
    };
    const total = await this.client.entitlementValidityChange.count({ where });
    if (offset >= total) {
      return { items: [], page: query.page, pageSize: query.pageSize, total };
    }
    const rows = await this.client.entitlementValidityChange.findMany({
      where,
      skip: offset,
      take: query.pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return {
      items: rows.map(({ organizationId: _organizationId, ...item }) => item),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async saveEntitlementValidityChange(
    organizationId: string,
    item: EntitlementValidityChange,
  ): Promise<void> {
    await this.client.entitlementValidityChange.create({
      data: { ...item, organizationId },
    });
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
      await this.client.creditReservation.updateMany({
        where: {
          organizationId,
          status: "RESERVED",
          booking: { sessionId: session.id },
        },
        data: { expiresAt: session.endsAt },
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
    const rows = await this.client.booking.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
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
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
        entitlementId: booking.entitlementId ?? null,
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
        entitlementId: notification.entitlementId,
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
    const existing = this.transactions.getStore();
    if (existing) {
      await existing.$queryRaw(
        Prisma.sql`SELECT "id" FROM "CourseSession"
                   WHERE "organizationId" = ${organizationId}
                     AND "id" = ${sessionId}
                   FOR UPDATE`,
      );
      return action();
    }
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
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (transaction) => this.transactions.run(transaction, action),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!this.isTransactionWriteConflict(error) || attempt >= TRANSACTION_MAX_ATTEMPTS) {
          throw error;
        }
      }
    }
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

  private async requirePlatformOrganization(id: string): Promise<void> {
    const exists = await this.client.organization.count({ where: { id, deletedAt: null } });
    if (!exists) {
      throw new DomainError("ORGANIZATION_NOT_FOUND", "机构不存在或已删除", 404);
    }
  }

  private async requireTenantAdmin(organizationId: string, userId: string): Promise<void> {
    const exists = await this.client.user.count({
      where: { id: userId, organizationId, role: "ADMIN" },
    });
    if (!exists) {
      throw new DomainError("TENANT_ADMIN_NOT_FOUND", "机构管理员不存在", 404);
    }
  }

  private throwPlatformConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainError("DUPLICATE_RESOURCE", "编码、手机号或账号已存在", 409);
    }
    throw error;
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
      entitlementId: row.entitlementId,
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
      entitlementId: row.entitlementId,
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

  private isTransactionWriteConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    );
  }

  private isUniqueConstraint(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }
}
