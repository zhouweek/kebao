import Fastify, { type FastifyInstance } from "fastify";
import {
  DomainError,
  SchedulingService,
  type AttendanceStatus,
  type CreateSessionInput,
  type Repository,
  type SessionFilter,
  type SessionStatus,
  type UserIdentity,
  type UserRole,
} from "./domain.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: UserIdentity;
  }
}

interface SessionQuery {
  from?: string;
  to?: string;
  teacherId?: string;
  campusId?: string;
  status?: SessionStatus;
}

interface CreateSessionBody {
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  classroomId?: string | null;
  classroomName?: string | null;
  teacherId: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status?: SessionStatus;
  bookingOpensAt?: string;
  bookingClosesAt?: string;
  cancelDeadlineAt?: string;
}

interface RescheduleSessionBody {
  startsAt: string;
  endsAt: string;
  teacherId?: string;
  teacherName?: string;
  classroomId?: string | null;
  classroomName?: string | null;
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("INVALID_DATE", `${field} 不是有效的日期时间`, 400);
  }
  return parsed;
}

function parseOptionalDate(
  value: string | undefined,
  field: string,
): Date | undefined {
  return value === undefined ? undefined : parseDate(value, field);
}

export function buildApp(
  repository: Repository,
  options: { developmentIdentityEnabled?: boolean } = {},
): FastifyInstance {
  const app = Fastify({ logger: false });

  const authorize =
    (roles: UserRole[]) =>
    async (request: { auth: UserIdentity }): Promise<void> => {
      if (!roles.includes(request.auth.role)) {
        throw new DomainError("FORBIDDEN", "当前身份无权执行此操作", 403);
      }
    };

  const serviceFor = (identity: UserIdentity) =>
    new SchedulingService(
      repository,
      undefined,
      undefined,
      identity.organizationId,
      identity.id,
    );

  const requireManagedSession = async (
    identity: UserIdentity,
    sessionId: string,
  ): Promise<void> => {
    if (identity.role !== "TEACHER") return;
    const session = await repository.getSession(identity.organizationId, sessionId);
    if (!session || session.teacherId !== identity.id) {
      throw new DomainError("SESSION_FORBIDDEN", "老师只能操作自己的课次", 403);
    }
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error
    ) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error instanceof Error ? error.message : "请求参数校验失败",
        },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误" },
    });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.addHook("onRequest", async (request) => {
    if (request.url.split("?")[0] === "/health") return;
    if (!options.developmentIdentityEnabled) {
      throw new DomainError(
        "AUTH_NOT_CONFIGURED",
        "生产身份认证尚未配置，开发身份请求头已禁用",
        503,
      );
    }
    const tenantId = request.headers["x-tenant-id"];
    const role = request.headers["x-role"];
    const userId = request.headers["x-user-id"];
    if (
      typeof tenantId !== "string" ||
      typeof role !== "string" ||
      typeof userId !== "string"
    ) {
      throw new DomainError(
        "DEVELOPMENT_IDENTITY_REQUIRED",
        "缺少开发身份请求头 x-tenant-id、x-role 或 x-user-id",
        401,
      );
    }
    if (!["ADMIN", "TEACHER", "GUARDIAN"].includes(role)) {
      throw new DomainError("INVALID_ROLE", "x-role 不是有效角色", 401);
    }
    if (!(await repository.organizationExists(tenantId))) {
      throw new DomainError("TENANT_NOT_FOUND", "机构不存在", 401);
    }
    const identity = await repository.getUserIdentity(tenantId, userId);
    if (!identity) {
      throw new DomainError("IDENTITY_NOT_FOUND", "用户不属于该机构", 401);
    }
    if (identity.role !== role) {
      throw new DomainError("ROLE_MISMATCH", "请求角色与用户身份不匹配", 403);
    }
    request.auth = identity;
  });

  app.get<{ Querystring: SessionQuery }>("/sessions", async (request) => {
    const query = request.query;
    const filter: SessionFilter = {};
    if (query.from !== undefined) filter.from = parseDate(query.from, "from");
    if (query.to !== undefined) filter.to = parseDate(query.to, "to");
    if (query.teacherId !== undefined) filter.teacherId = query.teacherId;
    if (query.campusId !== undefined) filter.campusId = query.campusId;
    if (query.status !== undefined) filter.status = query.status;
    return { data: await serviceFor(request.auth).listSessions(filter) };
  });

  app.post<{ Body: CreateSessionBody }>(
    "/sessions",
    {
      preHandler: authorize(["ADMIN", "TEACHER"]),
      schema: {
        body: {
          type: "object",
          required: [
            "courseId",
            "courseName",
            "campusId",
            "campusName",
            "teacherId",
            "teacherName",
            "startsAt",
            "endsAt",
            "capacity",
          ],
          properties: {
            courseId: { type: "string", minLength: 1 },
            courseName: { type: "string", minLength: 1 },
            campusId: { type: "string", minLength: 1 },
            campusName: { type: "string", minLength: 1 },
            classroomId: { type: ["string", "null"] },
            classroomName: { type: ["string", "null"] },
            teacherId: { type: "string", minLength: 1 },
            teacherName: { type: "string", minLength: 1 },
            startsAt: { type: "string" },
            endsAt: { type: "string" },
            capacity: { type: "integer", minimum: 1 },
            status: {
              type: "string",
              enum: ["DRAFT", "PUBLISHED", "CLOSED", "CANCELLED", "FINISHED"],
            },
            bookingOpensAt: { type: "string" },
            bookingClosesAt: { type: "string" },
            cancelDeadlineAt: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (request.auth.role === "TEACHER" && body.teacherId !== request.auth.id) {
        throw new DomainError("TEACHER_SCOPE_FORBIDDEN", "老师只能为自己创建课次", 403);
      }
      const input: CreateSessionInput = {
        courseId: body.courseId,
        courseName: body.courseName,
        campusId: body.campusId,
        campusName: body.campusName,
        teacherId: body.teacherId,
        teacherName: body.teacherName,
        startsAt: parseDate(body.startsAt, "startsAt"),
        endsAt: parseDate(body.endsAt, "endsAt"),
        capacity: body.capacity,
      };
      if (body.classroomId !== undefined) input.classroomId = body.classroomId;
      if (body.classroomName !== undefined) input.classroomName = body.classroomName;
      if (body.status !== undefined) input.status = body.status;
      const bookingOpensAt = parseOptionalDate(body.bookingOpensAt, "bookingOpensAt");
      const bookingClosesAt = parseOptionalDate(body.bookingClosesAt, "bookingClosesAt");
      const cancelDeadlineAt = parseOptionalDate(
        body.cancelDeadlineAt,
        "cancelDeadlineAt",
      );
      if (bookingOpensAt) input.bookingOpensAt = bookingOpensAt;
      if (bookingClosesAt) input.bookingClosesAt = bookingClosesAt;
      if (cancelDeadlineAt) input.cancelDeadlineAt = cancelDeadlineAt;

      const session = await serviceFor(request.auth).createSession(input);
      return reply.status(201).send({ data: session });
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { studentId: string };
  }>(
    "/sessions/:sessionId/bookings",
    {
      preHandler: authorize(["ADMIN", "GUARDIAN"]),
      schema: {
        body: {
          type: "object",
          required: ["studentId"],
          properties: { studentId: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (
        request.auth.role === "GUARDIAN" &&
        !(await repository.isGuardianOfStudent(
          request.auth.organizationId,
          request.auth.id,
          request.body.studentId,
        ))
      ) {
        throw new DomainError("STUDENT_FORBIDDEN", "无权为该学生预约", 403);
      }
      const result = await serviceFor(request.auth).book(
        request.params.sessionId,
        request.body.studentId,
      );
      return reply.status(result.alreadyBooked ? 200 : 201).send({ data: result });
    },
  );

  app.patch<{
    Params: { sessionId: string };
    Body: RescheduleSessionBody;
  }>(
    "/sessions/:sessionId/reschedule",
    {
      preHandler: authorize(["ADMIN", "TEACHER"]),
      schema: {
        body: {
          type: "object",
          required: ["startsAt", "endsAt"],
          properties: {
            startsAt: { type: "string" },
            endsAt: { type: "string" },
            teacherId: { type: "string", minLength: 1 },
            teacherName: { type: "string", minLength: 1 },
            classroomId: { type: ["string", "null"] },
            classroomName: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      await requireManagedSession(request.auth, request.params.sessionId);
      if (
        request.auth.role === "TEACHER" &&
        request.body.teacherId !== undefined &&
        request.body.teacherId !== request.auth.id
      ) {
        throw new DomainError("TEACHER_SCOPE_FORBIDDEN", "老师不可将课次转给他人", 403);
      }
      return {
        data: await serviceFor(request.auth).rescheduleSession(request.params.sessionId, {
          ...request.body,
          startsAt: parseDate(request.body.startsAt, "startsAt"),
          endsAt: parseDate(request.body.endsAt, "endsAt"),
        }),
      };
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { reason?: string };
  }>(
    "/sessions/:sessionId/cancel",
    {
      preHandler: authorize(["ADMIN", "TEACHER"]),
      schema: {
        body: {
          type: "object",
          properties: { reason: { type: "string", maxLength: 500 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      await requireManagedSession(request.auth, request.params.sessionId);
      return {
        data: await serviceFor(request.auth).cancelSession(
          request.params.sessionId,
          request.body.reason,
        ),
      };
    },
  );

  app.put<{
    Params: { sessionId: string };
    Body: { records: Array<{ bookingId: string; status: AttendanceStatus }> };
  }>(
    "/sessions/:sessionId/attendance",
    {
      preHandler: authorize(["ADMIN", "TEACHER"]),
      schema: {
        body: {
          type: "object",
          required: ["records"],
          properties: {
            records: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["bookingId", "status"],
                properties: {
                  bookingId: { type: "string", minLength: 1 },
                  status: { type: "string", enum: ["ATTENDED", "LEAVE", "ABSENT"] },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      await requireManagedSession(request.auth, request.params.sessionId);
      return {
        data: await serviceFor(request.auth).markAttendance(
          request.params.sessionId,
          request.body.records,
        ),
      };
    },
  );

  app.delete<{ Params: { bookingId: string } }>(
    "/bookings/:bookingId",
    { preHandler: authorize(["ADMIN", "GUARDIAN"]) },
    async (request) => {
      if (request.auth.role === "GUARDIAN") {
        const booking = await repository.getBooking(
          request.auth.organizationId,
          request.params.bookingId,
        );
        if (
          !booking ||
          !(await repository.isGuardianOfStudent(
            request.auth.organizationId,
            request.auth.id,
            booking.studentId,
          ))
        ) {
          throw new DomainError("BOOKING_FORBIDDEN", "无权取消该预约", 403);
        }
      }
      return {
        data: await serviceFor(request.auth).cancelBooking(request.params.bookingId),
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/teacher/sessions/:sessionId/roster",
    { preHandler: authorize(["ADMIN", "TEACHER"]) },
    async (request) => {
      if (request.auth.role === "TEACHER") {
        const session = await repository.getSession(
          request.auth.organizationId,
          request.params.sessionId,
        );
        if (!session || session.teacherId !== request.auth.id) {
          throw new DomainError("SESSION_FORBIDDEN", "无权查看该课次名单", 403);
        }
      }
      return {
        data: await serviceFor(request.auth).getRoster(request.params.sessionId),
      };
    },
  );

  app.get<{ Querystring: { unreadOnly?: string } }>(
    "/notifications",
    async (request) => ({
      data: await serviceFor(request.auth).listNotifications(
        request.auth.id,
        request.query.unreadOnly === "true",
      ),
    }),
  );

  app.patch<{ Params: { notificationId: string } }>(
    "/notifications/:notificationId/read",
    async (request) => ({
      data: await serviceFor(request.auth).markNotificationRead(
        request.params.notificationId,
        request.auth.id,
      ),
    }),
  );

  app.get(
    "/audit-logs",
    { preHandler: authorize(["ADMIN"]) },
    async (request) => ({ data: await serviceFor(request.auth).listAuditLogs() }),
  );

  return app;
}
