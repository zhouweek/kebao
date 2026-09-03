import Fastify, { type FastifyInstance } from "fastify";
import { AnalyticsService, type AnalyticsFilter } from "./analytics.js";
import { AuthService, type AuthUser } from "./auth.js";
import {
  DomainError,
  SchedulingService,
  type AttendanceStatus,
  type AdminBookingFilter,
  type BookingStatus,
  type CreateSessionInput,
  type CreateSeriesInput,
  type SeriesOperationScope,
  type Repository,
  type SessionFilter,
  type SessionStatus,
  type UserIdentity,
  type UserRole,
} from "./domain.js";
import { registerMasterDataRoutes } from "./master-data.js";
import type { NotificationWorker } from "./notification-worker.js";
import { HttpMetrics } from "./observability.js";
import { FixedWindowRateLimiter, maskPhone, safeTokenEqual } from "./security.js";

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

interface AdminBookingQuery {
  page?: string;
  pageSize?: string;
  sessionId?: string;
  studentId?: string;
  status?: BookingStatus;
  from?: string;
  to?: string;
}

interface AnalyticsQuery {
  from?: string;
  to?: string;
  campusId?: string;
  courseId?: string;
  teacherId?: string;
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
  scope?: SeriesOperationScope;
}

interface CreateSeriesBody extends CreateSessionBody {
  recurrence: "WEEKLY";
  intervalWeeks?: number;
  repeatCount: number;
  skipConflicts?: boolean;
}

interface BuildAppOptions {
  developmentIdentityEnabled?: boolean;
  tokenSecret?: string;
  wechatIdentityResolver?: (
    loginCode: string,
    phoneCode: string,
  ) => Promise<{ openId: string; phone: string }>;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  now?: () => Date;
  notificationWorker?: NotificationWorker;
  corsOrigins?: string[];
  rateLimit?: { maximum: number; windowMs: number };
  metricsToken?: string;
  readinessCheck?: () => Promise<void>;
  logger?: boolean;
  trustProxy?: boolean;
}

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
    name: user.name,
    phone: user.phone,
  };
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

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  field: string,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new DomainError(
      "INVALID_PAGINATION",
      `${field} 必须是 1 到 ${maximum} 之间的整数`,
      400,
    );
  }
  return parsed;
}

export function buildApp(
  repository: Repository,
  options: BuildAppOptions = {},
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? false,
    requestIdHeader: "x-request-id",
    ajv: { customOptions: { removeAdditional: false } },
  });
  const metrics = new HttpMetrics();
  const rateLimiter = options.rateLimit
    ? new FixedWindowRateLimiter(options.rateLimit.maximum, options.rateLimit.windowMs)
    : undefined;
  const corsOrigins = new Set(options.corsOrigins ?? []);
  const authService = new AuthService(repository, {
    tokenSecret: options.tokenSecret ?? "development-only-change-me",
    ...(options.accessTokenTtlSeconds === undefined
      ? {}
      : { accessTokenTtlSeconds: options.accessTokenTtlSeconds }),
    ...(options.refreshTokenTtlSeconds === undefined
      ? {}
      : { refreshTokenTtlSeconds: options.refreshTokenTtlSeconds }),
    ...(options.now ? { now: options.now } : {}),
  });

  const bearerToken = (authorization: string | undefined): string | undefined => {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1];
  };

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

  const analyticsFor = (identity: UserIdentity) =>
    new AnalyticsService(repository, identity.organizationId, identity.id, options.now);

  const parseAnalyticsFilter = (query: AnalyticsQuery): AnalyticsFilter => {
    const filter: AnalyticsFilter = {};
    if (query.from) filter.from = parseDate(query.from, "from");
    if (query.to) filter.to = parseDate(query.to, "to");
    if (query.campusId) filter.campusId = query.campusId;
    if (query.courseId) filter.courseId = query.courseId;
    if (query.teacherId) filter.teacherId = query.teacherId;
    return filter;
  };

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

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    const origin = request.headers.origin;
    if (origin && corsOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      if (origin && !corsOrigins.has(origin)) {
        return reply.status(403).send({
          error: { code: "CORS_ORIGIN_DENIED", message: "请求来源不在允许列表中" },
          requestId: request.id,
        });
      }
      return reply.status(204).send();
    }
    if (rateLimiter) {
      const limit = rateLimiter.consume(request.ip);
      reply.header("RateLimit-Limit", options.rateLimit!.maximum);
      reply.header("RateLimit-Remaining", limit.remaining);
      reply.header("RateLimit-Reset", Math.ceil(limit.resetAt / 1000));
      if (!limit.allowed) {
        return reply.status(429).send({
          error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后重试" },
          requestId: request.id,
        });
      }
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    metrics.observe(
      request.method,
      request.routeOptions.url ?? "unmatched",
      reply.statusCode,
      reply.elapsedTime,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id,
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
        requestId: request.id,
      });
    }
    request.log.error({ err: error, requestId: request.id }, "请求处理失败");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误" },
      requestId: request.id,
    });
  });

  app.get("/health", async (request) => ({ status: "ok", requestId: request.id }));
  app.get("/ready", async (request, reply) => {
    try {
      await options.readinessCheck?.();
      return { status: "ready", requestId: request.id };
    } catch (error) {
      request.log.warn({ err: error, requestId: request.id }, "就绪检查失败");
      return reply.status(503).send({ status: "not_ready", requestId: request.id });
    }
  });
  app.get("/metrics", async (request, reply) => {
    if (options.metricsToken) {
      const token = bearerToken(request.headers.authorization);
      if (!safeTokenEqual(token, options.metricsToken)) {
        return reply.status(401).send({
          error: { code: "METRICS_AUTH_REQUIRED", message: "指标访问凭证无效" },
          requestId: request.id,
        });
      }
    }
    return reply.type("text/plain; version=0.0.4; charset=utf-8").send(metrics.render());
  });

  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0];
    if (
      path === "/health" ||
      path === "/ready" ||
      path === "/metrics" ||
      path === "/auth/admin/login" ||
      path === "/auth/wechat/login" ||
      path === "/auth/refresh"
    ) {
      return;
    }
    const token = bearerToken(request.headers.authorization);
    if (token) {
      const user = await authService.authenticate(token);
      request.auth = {
        id: user.id,
        organizationId: user.organizationId,
        role: user.role,
      };
      return;
    }
    if (!options.developmentIdentityEnabled) {
      throw new DomainError("AUTH_REQUIRED", "请先登录", 401);
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

  app.post<{ Body: { organizationCode: string; phone: string; password: string } }>(
    "/auth/admin/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["organizationCode", "phone", "password"],
          properties: {
            organizationCode: { type: "string", minLength: 1, maxLength: 64 },
            phone: { type: "string", minLength: 6, maxLength: 32 },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const result = await authService.loginAdmin(
        request.body.organizationCode.trim(),
        request.body.phone.trim(),
        request.body.password,
      );
      return { data: { ...result.tokens, user: publicUser(result.user) } };
    },
  );

  app.post<{
    Body: { organizationCode: string; loginCode: string; phoneCode: string };
  }>(
    "/auth/wechat/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["organizationCode", "loginCode", "phoneCode"],
          properties: {
            organizationCode: { type: "string", minLength: 1, maxLength: 64 },
            loginCode: { type: "string", minLength: 1, maxLength: 256 },
            phoneCode: { type: "string", minLength: 1, maxLength: 256 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      if (!options.wechatIdentityResolver) {
        throw new DomainError("WECHAT_NOT_CONFIGURED", "微信登录尚未配置", 503);
      }
      const identity = await options.wechatIdentityResolver(
        request.body.loginCode,
        request.body.phoneCode,
      );
      const result = await authService.loginWechat(
        request.body.organizationCode.trim(),
        identity.phone,
        identity.openId,
      );
      return { data: { ...result.tokens, user: publicUser(result.user) } };
    },
  );

  app.post<{ Body: { refreshToken: string } }>(
    "/auth/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => ({
      data: await authService.refresh(request.body.refreshToken),
    }),
  );

  app.post("/auth/logout", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (token) await authService.logout(token);
    return reply.status(204).send();
  });

  app.get("/auth/me", async (request) => {
    const user = await repository.getAuthUser(
      request.auth.id,
      request.auth.organizationId,
    );
    if (!user || !user.isActive) {
      throw new DomainError("USER_DISABLED", "用户已停用", 403);
    }
    return { data: publicUser(user) };
  });

  app.get<{ Querystring: SessionQuery }>("/sessions", async (request) => {
    const query = request.query;
    const filter: SessionFilter = {};
    if (query.from !== undefined) filter.from = parseDate(query.from, "from");
    if (query.to !== undefined) filter.to = parseDate(query.to, "to");
    if (request.auth.role === "TEACHER") {
      filter.teacherId = request.auth.id;
    } else if (query.teacherId !== undefined) {
      filter.teacherId = query.teacherId;
    }
    if (query.campusId !== undefined) filter.campusId = query.campusId;
    if (query.status !== undefined) filter.status = query.status;
    return { data: await serviceFor(request.auth).listSessions(filter) };
  });

  app.get<{ Querystring: AdminBookingQuery }>(
    "/admin/bookings",
    {
      preHandler: authorize(["ADMIN"]),
      schema: {
        querystring: {
          type: "object",
          properties: {
            page: { type: "string" },
            pageSize: { type: "string" },
            sessionId: { type: "string", minLength: 1 },
            studentId: { type: "string", minLength: 1 },
            status: {
              type: "string",
              enum: [
                "CONFIRMED",
                "CANCELLED",
                "COURSE_CANCELLED",
                "ATTENDED",
                "LEAVE",
                "ABSENT",
              ],
            },
            from: { type: "string" },
            to: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const query = request.query;
      const filter: AdminBookingFilter = {
        page: parsePositiveInteger(query.page, 1, "page", 1_000_000),
        pageSize: parsePositiveInteger(query.pageSize, 20, "pageSize", 100),
      };
      if (query.sessionId) filter.sessionId = query.sessionId;
      if (query.studentId) filter.studentId = query.studentId;
      if (query.status) filter.status = query.status;
      if (query.from) filter.from = parseDate(query.from, "from");
      if (query.to) filter.to = parseDate(query.to, "to");
      if (filter.from && filter.to && filter.from >= filter.to) {
        throw new DomainError("INVALID_TIME_RANGE", "to 必须晚于 from", 400);
      }
      return { data: await serviceFor(request.auth).listAdminBookings(filter) };
    },
  );

  app.post<{ Body: { sessionId: string; studentId: string } }>(
    "/admin/bookings",
    {
      preHandler: authorize(["ADMIN"]),
      schema: {
        body: {
          type: "object",
          required: ["sessionId", "studentId"],
          properties: {
            sessionId: { type: "string", minLength: 1 },
            studentId: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const result = await serviceFor(request.auth).bookForAdmin(
        request.body.sessionId,
        request.body.studentId,
      );
      return reply.status(result.alreadyBooked ? 200 : 201).send({ data: result });
    },
  );

  app.post<{
    Params: { bookingId: string };
    Body: { reason: string };
  }>(
    "/admin/bookings/:bookingId/cancel",
    {
      preHandler: authorize(["ADMIN"]),
      schema: {
        body: {
          type: "object",
          required: ["reason"],
          properties: { reason: { type: "string", minLength: 1, maxLength: 500 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => ({
      data: await serviceFor(request.auth).cancelBookingForAdmin(
        request.params.bookingId,
        request.body.reason,
      ),
    }),
  );

  app.get(
    "/teacher/options",
    { preHandler: authorize(["TEACHER"]) },
    async (request) => {
      const organizationId = request.auth.organizationId;
      const teacher = await repository.getMasterData(
        organizationId,
        "teachers",
        request.auth.id,
      );
      if (!teacher?.isActive) {
        throw new DomainError("TEACHER_DISABLED", "当前老师资料未启用", 403);
      }
      const query = { page: 1, pageSize: 100, activeOnly: true };
      const [courses, campuses, classrooms] = await Promise.all([
        repository.listMasterData(organizationId, "courses", query),
        repository.listMasterData(organizationId, "campuses", query),
        repository.listMasterData(organizationId, "classrooms", query),
      ]);
      return {
        data: {
          teacher: { id: teacher.id, name: teacher.name },
          courses: courses.items,
          campuses: campuses.items,
          classrooms: classrooms.items,
        },
      };
    },
  );

  app.get(
    "/admin/notification-deliveries",
    { preHandler: authorize(["ADMIN"]) },
    async (request) => ({
      data: await repository.listAdminNotificationDeliveries(
        request.auth.organizationId,
        200,
      ),
    }),
  );

  app.get("/notifications/subscription-config", async () => ({
    data: {
      templateIds: options.notificationWorker?.subscriptionTemplateIds() ?? [],
    },
  }));

  app.post<{ Params: { deliveryId: string } }>(
    "/admin/notification-deliveries/:deliveryId/resend",
    { preHandler: authorize(["ADMIN"]) },
    async (request) => {
      if (!options.notificationWorker) {
        throw new DomainError("NOTIFICATION_WORKER_UNAVAILABLE", "通知任务未启用", 503);
      }
      await options.notificationWorker.resend(
        request.auth.organizationId,
        request.params.deliveryId,
      );
      return { data: { accepted: true } };
    },
  );

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
      let courseName = body.courseName;
      let campusName = body.campusName;
      let classroomName = body.classroomName;
      let teacherName = body.teacherName;
      if (request.auth.role === "TEACHER") {
        const organizationId = request.auth.organizationId;
        const [course, campus, teacher, classroom] = await Promise.all([
          repository.getMasterData(organizationId, "courses", body.courseId),
          repository.getMasterData(organizationId, "campuses", body.campusId),
          repository.getMasterData(organizationId, "teachers", body.teacherId),
          body.classroomId
            ? repository.getMasterData(organizationId, "classrooms", body.classroomId)
            : Promise.resolve(undefined),
        ]);
        if (!course?.isActive) {
          throw new DomainError("COURSE_UNAVAILABLE", "课程不存在、已停用或不属于当前机构", 400);
        }
        if (!campus?.isActive) {
          throw new DomainError("CAMPUS_UNAVAILABLE", "校区不存在、已停用或不属于当前机构", 400);
        }
        if (!teacher?.isActive || teacher.id !== request.auth.id) {
          throw new DomainError("TEACHER_UNAVAILABLE", "老师不存在、已停用或不属于当前机构", 400);
        }
        if (
          body.classroomId &&
          (!classroom?.isActive || classroom.campusId !== campus.id)
        ) {
          throw new DomainError(
            "CLASSROOM_UNAVAILABLE",
            "教室不存在、已停用、不属于当前机构或不在所选校区",
            400,
          );
        }
        courseName = course.name;
        campusName = campus.name;
        teacherName = teacher.name;
        classroomName = classroom?.name ?? null;
      }
      const input: CreateSessionInput = {
        courseId: body.courseId,
        courseName,
        campusId: body.campusId,
        campusName,
        teacherId: body.teacherId,
        teacherName,
        startsAt: parseDate(body.startsAt, "startsAt"),
        endsAt: parseDate(body.endsAt, "endsAt"),
        capacity: body.capacity,
      };
      if (body.classroomId !== undefined) input.classroomId = body.classroomId;
      if (classroomName !== undefined) input.classroomName = classroomName;
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

  const seriesBodySchema = {
    type: "object",
    required: [
      "courseId", "courseName", "campusId", "campusName", "teacherId", "teacherName",
      "startsAt", "endsAt", "capacity", "recurrence", "repeatCount",
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
      status: { type: "string", enum: ["DRAFT", "PUBLISHED"] },
      recurrence: { type: "string", enum: ["WEEKLY"] },
      intervalWeeks: { type: "integer", minimum: 1, maximum: 52 },
      repeatCount: { type: "integer", minimum: 1, maximum: 104 },
      skipConflicts: { type: "boolean" },
    },
    additionalProperties: false,
  } as const;

  const parseSeriesInput = async (
    identity: UserIdentity,
    body: CreateSeriesBody,
  ): Promise<CreateSeriesInput> => {
    if (identity.role === "TEACHER" && body.teacherId !== identity.id) {
      throw new DomainError("TEACHER_SCOPE_FORBIDDEN", "老师只能为自己创建课次", 403);
    }
    const organizationId = identity.organizationId;
    const [course, campus, teacher, classroom] = await Promise.all([
      repository.getMasterData(organizationId, "courses", body.courseId),
      repository.getMasterData(organizationId, "campuses", body.campusId),
      repository.getMasterData(organizationId, "teachers", body.teacherId),
      body.classroomId
        ? repository.getMasterData(organizationId, "classrooms", body.classroomId)
        : Promise.resolve(undefined),
    ]);
    if (!course?.isActive || !campus?.isActive || !teacher?.isActive) {
      throw new DomainError("MASTER_DATA_UNAVAILABLE", "课程、校区或老师不可用", 400);
    }
    if (body.classroomId && (!classroom?.isActive || classroom.campusId !== campus.id)) {
      throw new DomainError("CLASSROOM_UNAVAILABLE", "教室不可用或不在所选校区", 400);
    }
    return {
      courseId: course.id,
      courseName: course.name,
      campusId: campus.id,
      campusName: campus.name,
      classroomId: classroom?.id ?? null,
      classroomName: classroom?.name ?? null,
      teacherId: teacher.id,
      teacherName: teacher.name,
      startsAt: parseDate(body.startsAt, "startsAt"),
      endsAt: parseDate(body.endsAt, "endsAt"),
      capacity: body.capacity,
      status: body.status ?? "PUBLISHED",
      recurrence: body.recurrence,
      intervalWeeks: body.intervalWeeks ?? 1,
      repeatCount: body.repeatCount,
      skipConflicts: body.skipConflicts ?? false,
    };
  };

  app.post<{ Body: CreateSeriesBody }>(
    "/session-series/preflight",
    {
      preHandler: authorize(["ADMIN", "TEACHER"]),
      schema: { body: seriesBodySchema },
    },
    async (request) => ({
      data: await serviceFor(request.auth).previewSeries(
        await parseSeriesInput(request.auth, request.body),
      ),
    }),
  );

  app.post<{ Body: CreateSeriesBody }>(
    "/session-series",
    {
      preHandler: authorize(["ADMIN", "TEACHER"]),
      schema: { body: seriesBodySchema },
    },
    async (request, reply) =>
      reply.status(201).send({
        data: await serviceFor(request.auth).createSeries(
          await parseSeriesInput(request.auth, request.body),
        ),
      }),
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
      if (request.auth.role === "ADMIN") {
        const adminResult = await serviceFor(request.auth).bookForAdmin(
          request.params.sessionId,
          request.body.studentId,
        );
        return reply
          .status(adminResult.alreadyBooked ? 200 : 201)
          .send({ data: adminResult });
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
            scope: { type: "string", enum: ["THIS", "THIS_AND_FUTURE"] },
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
      const scope = request.body.scope ?? "THIS";
      const sessions = await serviceFor(request.auth).rescheduleWithScope(request.params.sessionId, {
          ...request.body,
          startsAt: parseDate(request.body.startsAt, "startsAt"),
          endsAt: parseDate(request.body.endsAt, "endsAt"),
        }, scope);
      return { data: scope === "THIS" ? sessions[0] : { sessions } };
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { reason?: string; scope?: SeriesOperationScope };
  }>(
    "/sessions/:sessionId/cancel",
    {
      preHandler: authorize(["ADMIN", "TEACHER"]),
      schema: {
        body: {
          type: "object",
          properties: {
            reason: { type: "string", maxLength: 500 },
            scope: { type: "string", enum: ["THIS", "THIS_AND_FUTURE"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      await requireManagedSession(request.auth, request.params.sessionId);
      const scope = request.body.scope ?? "THIS";
      const sessions = await serviceFor(request.auth).cancelWithScope(
        request.params.sessionId,
        request.body.reason,
        scope,
      );
      return { data: scope === "THIS" ? sessions[0] : { sessions } };
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
    { preHandler: authorize(["GUARDIAN"]) },
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
        data: (await serviceFor(request.auth).getRoster(request.params.sessionId)).map(
          (student) => ({
            ...student,
            guardianPhone: maskPhone(student.guardianPhone),
          }),
        ),
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

  app.get<{ Querystring: AnalyticsQuery }>(
    "/admin/statistics",
    { preHandler: authorize(["ADMIN"]) },
    async (request) => ({
      data: await analyticsFor(request.auth).getStatistics(
        parseAnalyticsFilter(request.query),
      ),
    }),
  );

  app.get<{ Querystring: AnalyticsQuery }>(
    "/admin/statistics/export",
    { preHandler: authorize(["ADMIN"]) },
    async (request, reply) => {
      const exported = await analyticsFor(request.auth).exportCsv(
        parseAnalyticsFilter(request.query),
      );
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${exported.filename}"`,
        )
        .send(exported.csv);
    },
  );

  app.get(
    "/audit-logs",
    { preHandler: authorize(["ADMIN"]) },
    async (request) => ({ data: await serviceFor(request.auth).listAuditLogs() }),
  );

  registerMasterDataRoutes(app, repository, authorize(["ADMIN"]));

  return app;
}
