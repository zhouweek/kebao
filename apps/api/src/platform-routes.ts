import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { generateTemporaryPassword, hashPassword } from "./auth.js";
import { DomainError, type Repository } from "./domain.js";
import { PlatformService, type PlatformAccount } from "./platform.js";

declare module "fastify" {
  interface FastifyRequest {
    platformAuth?: PlatformAccount;
  }
}

interface PlatformRouteOptions {
  tokenSecret: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  now?: () => Date;
}

const bearerToken = (authorization: string | undefined): string | undefined =>
  authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

const publicAccount = (account: PlatformAccount) => ({
  id: account.id,
  username: account.username,
  name: account.name,
  isActive: account.isActive,
  mustChangePassword: account.mustChangePassword,
});

export function registerPlatformRoutes(
  app: FastifyInstance,
  repository: Repository,
  options: PlatformRouteOptions,
): void {
  const service = new PlatformService(repository, options.tokenSecret, {
    ...(options.accessTokenTtlSeconds === undefined
      ? {}
      : { accessTokenTtlSeconds: options.accessTokenTtlSeconds }),
    ...(options.refreshTokenTtlSeconds === undefined
      ? {}
      : { refreshTokenTtlSeconds: options.refreshTokenTtlSeconds }),
    ...(options.now ? { now: options.now } : {}),
  });

  const requirePlatform = async (request: FastifyRequest): Promise<void> => {
    const token = bearerToken(request.headers.authorization);
    if (!token) throw new DomainError("PLATFORM_AUTH_REQUIRED", "请先登录平台", 401);
    request.platformAuth = await service.authenticate(token);
    if (
      request.platformAuth.mustChangePassword &&
      ![
        "/platform/auth/me",
        "/platform/auth/change-password",
        "/platform/auth/logout",
      ].includes(request.routeOptions.url ?? "")
    ) {
      throw new DomainError(
        "PASSWORD_CHANGE_REQUIRED",
        "首次登录或密码重置后必须修改密码",
        403,
      );
    }
  };

  const actor = (request: FastifyRequest): PlatformAccount => {
    if (!request.platformAuth) {
      throw new DomainError("PLATFORM_AUTH_REQUIRED", "请先登录平台", 401);
    }
    return request.platformAuth;
  };

  const write = <T>(action: () => Promise<T>): Promise<T> =>
    repository.withTransaction(action);

  const trimmedInRange = (
    value: string,
    field: string,
    minimum: number,
    maximum?: number,
  ): string => {
    const normalized = value.trim();
    if (normalized.length < minimum) {
      if (minimum === 1) {
        throw new DomainError("VALIDATION_ERROR", `${field} 不能为空`, 400);
      }
      throw new DomainError(
        "VALIDATION_ERROR",
        `${field}长度必须为 ${minimum} 到 ${maximum ?? "不限"} 个字符`,
        400,
      );
    }
    if (maximum !== undefined && normalized.length > maximum) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `${field}长度必须为 ${minimum} 到 ${maximum} 个字符`,
        400,
      );
    }
    return normalized;
  };

  const optionalTrimmed = (
    value: string | null | undefined,
    field: string,
    maximum: number,
  ): string | null => {
    const normalized = value?.trim() ?? "";
    if (!normalized) return null;
    if (normalized.length > maximum) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `${field}最多 ${maximum} 个字符`,
        400,
      );
    }
    return normalized;
  };

  const normalizedPhone = (value: string): string => {
    return trimmedInRange(value, "手机号", 6, 32);
  };

  const requireEmptyBody = async (request: FastifyRequest): Promise<void> => {
    if (
      request.body !== undefined &&
      request.body !== null &&
      (typeof request.body !== "object" ||
        Object.keys(request.body as Record<string, unknown>).length > 0)
    ) {
      throw new DomainError(
        "REQUEST_BODY_NOT_ALLOWED",
        "临时密码由服务端生成，请勿提交密码",
        400,
      );
    }
  };

  app.post<{ Body: { username: string; password: string } }>(
    "/platform/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const result = await service.login(
        trimmedInRange(request.body.username, "用户名", 1, 64),
        trimmedInRange(request.body.password, "密码", 8, 128),
      );
      return reply
        .header("Cache-Control", "no-store")
        .send({ data: { ...result.tokens, account: publicAccount(result.account) } });
    },
  );

  app.post<{ Body: { refreshToken: string } }>(
    "/platform/auth/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .send({
          data: await service.refresh(
            trimmedInRange(request.body.refreshToken, "刷新令牌", 1),
          ),
        }),
  );

  app.post(
    "/platform/auth/logout",
    { preHandler: requirePlatform },
    async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      await write(async () => {
        await service.audit(
          actor(request).id,
          "PLATFORM_LOGOUT",
          "PlatformAccount",
          actor(request).id,
          {},
        );
        if (token) await service.logout(token);
      });
      return reply.status(204).send();
    },
  );

  app.get("/platform/auth/me", { preHandler: requirePlatform }, async (request) => ({
    data: publicAccount(actor(request)),
  }));

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/platform/auth/change-password",
    {
      preHandler: requirePlatform,
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      await service.changePassword(
        actor(request),
        trimmedInRange(request.body.currentPassword, "当前密码", 8, 128),
        trimmedInRange(request.body.newPassword, "新密码", 8, 128),
      );
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { includeDeleted?: string } }>(
    "/platform/organizations",
    { preHandler: requirePlatform },
    async (request) => ({
      data: await repository.listPlatformOrganizations(
        request.query.includeDeleted === "true",
      ),
    }),
  );

  app.get<{ Params: { organizationId: string } }>(
    "/platform/organizations/:organizationId",
    { preHandler: requirePlatform },
    async (request, reply) => {
      const organization = await repository.getPlatformOrganization(
        request.params.organizationId,
      );
      if (!organization) {
        throw new DomainError("ORGANIZATION_NOT_FOUND", "机构不存在或已删除", 404);
      }
      return { data: organization };
    },
  );

  app.post<{ Body: { code: string; name: string } }>(
    "/platform/organizations",
    {
      preHandler: requirePlatform,
      schema: {
        body: {
          type: "object",
          required: ["code", "name"],
          properties: {
            code: { type: "string" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const organization = await write(async () => {
        const created = await repository.createPlatformOrganization({
          id: randomUUID(),
          code: trimmedInRange(request.body.code, "机构编码", 1, 64).toUpperCase(),
          name: trimmedInRange(request.body.name, "机构名称", 1, 128),
        });
        await service.audit(
          actor(request).id,
          "ORGANIZATION_CREATED",
          "Organization",
          created.id,
          { code: created.code, name: created.name },
        );
        return created;
      });
      return reply.status(201).send({ data: organization });
    },
  );

  app.patch<{
    Params: { organizationId: string };
    Body: { code?: string; name?: string };
  }>(
    "/platform/organizations/:organizationId",
    {
      preHandler: requirePlatform,
      schema: {
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            code: { type: "string" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const input: { code?: string; name?: string } = {};
      if (request.body.code !== undefined) {
        input.code = trimmedInRange(request.body.code, "机构编码", 1, 64).toUpperCase();
      }
      if (request.body.name !== undefined) {
        input.name = trimmedInRange(request.body.name, "机构名称", 1, 128);
      }
      const organization = await write(async () => {
        const updated = await repository.updatePlatformOrganization(
          request.params.organizationId,
          input,
        );
        await service.audit(actor(request).id, "ORGANIZATION_UPDATED", "Organization", updated.id, input);
        return updated;
      });
      return { data: organization };
    },
  );

  app.patch<{
    Params: { organizationId: string };
    Body: { isActive: boolean };
  }>(
    "/platform/organizations/:organizationId/status",
    {
      preHandler: requirePlatform,
      schema: {
        body: {
          type: "object",
          required: ["isActive"],
          properties: { isActive: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const organization = await write(async () => {
        const updated = await repository.setPlatformOrganizationActive(
          request.params.organizationId,
          request.body.isActive,
        );
        await service.audit(
          actor(request).id,
          request.body.isActive ? "ORGANIZATION_ENABLED" : "ORGANIZATION_DISABLED",
          "Organization",
          updated.id,
          {},
        );
        return updated;
      });
      return { data: organization };
    },
  );

  app.delete<{ Params: { organizationId: string } }>(
    "/platform/organizations/:organizationId",
    { preHandler: requirePlatform },
    async (request, reply) => {
      await write(async () => {
        await repository.softDeletePlatformOrganization(request.params.organizationId);
        await service.audit(
          actor(request).id,
          "ORGANIZATION_DELETED",
          "Organization",
          request.params.organizationId,
          {},
        );
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { organizationId: string } }>(
    "/platform/organizations/:organizationId/admins",
    { preHandler: requirePlatform },
    async (request) => ({
      data: await repository.listPlatformTenantAdmins(request.params.organizationId),
    }),
  );

  app.post<{
    Params: { organizationId: string };
    Body: { name: string; phone: string; email?: string | null };
  }>(
    "/platform/organizations/:organizationId/admins",
    {
      preHandler: requirePlatform,
      schema: {
        body: {
          type: "object",
          required: ["name", "phone"],
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const admin = await write(async () => {
        const created = await repository.createPlatformTenantAdmin({
          id: randomUUID(),
          organizationId: request.params.organizationId,
          name: trimmedInRange(request.body.name, "管理员姓名", 1, 128),
          phone: normalizedPhone(request.body.phone),
          email: optionalTrimmed(request.body.email, "邮箱", 254),
          passwordHash,
        });
        await service.audit(actor(request).id, "TENANT_ADMIN_CREATED", "User", created.id, {
          organizationId: created.organizationId,
        });
        return created;
      });
      return reply
        .header("Cache-Control", "no-store")
        .status(201)
        .send({ data: { ...admin, temporaryPassword } });
    },
  );

  app.patch<{
    Params: { organizationId: string; userId: string };
    Body: { name?: string; phone?: string; email?: string | null };
  }>(
    "/platform/organizations/:organizationId/admins/:userId",
    {
      preHandler: requirePlatform,
      schema: {
        body: {
          type: "object",
          minProperties: 1,
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const input: { name?: string; phone?: string; email?: string | null } = {};
      if (request.body.name !== undefined) {
        input.name = trimmedInRange(request.body.name, "管理员姓名", 1, 128);
      }
      if (request.body.phone !== undefined) {
        input.phone = normalizedPhone(request.body.phone);
      }
      if (request.body.email !== undefined) {
        input.email = optionalTrimmed(request.body.email, "邮箱", 254);
      }
      const admin = await write(async () => {
        const updated = await repository.updatePlatformTenantAdmin(
          request.params.organizationId,
          request.params.userId,
          input,
        );
        await service.audit(actor(request).id, "TENANT_ADMIN_UPDATED", "User", updated.id, {
          organizationId: updated.organizationId,
          fields: Object.keys(input),
        });
        return updated;
      });
      return { data: admin };
    },
  );

  app.patch<{
    Params: { organizationId: string; userId: string };
    Body: { isActive: boolean };
  }>(
    "/platform/organizations/:organizationId/admins/:userId/status",
    {
      preHandler: requirePlatform,
      schema: {
        body: {
          type: "object",
          required: ["isActive"],
          properties: { isActive: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const admin = await write(async () => {
        const updated = await repository.setPlatformTenantAdminActive(
          request.params.organizationId,
          request.params.userId,
          request.body.isActive,
        );
        await service.audit(
          actor(request).id,
          request.body.isActive ? "TENANT_ADMIN_ENABLED" : "TENANT_ADMIN_DISABLED",
          "User",
          updated.id,
          { organizationId: updated.organizationId },
        );
        return updated;
      });
      return { data: admin };
    },
  );

  app.post<{
    Params: { organizationId: string; userId: string };
  }>(
    "/platform/organizations/:organizationId/admins/:userId/reset-password",
    {
      preHandler: [requirePlatform, requireEmptyBody],
    },
    async (request, reply) => {
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      await write(async () => {
        await repository.resetPlatformTenantAdminPassword(
          request.params.organizationId,
          request.params.userId,
          passwordHash,
        );
        await service.audit(actor(request).id, "TENANT_ADMIN_PASSWORD_RESET", "User", request.params.userId, {
          organizationId: request.params.organizationId,
        });
      });
      return reply
        .header("Cache-Control", "no-store")
        .send({ data: { temporaryPassword } });
    },
  );

  app.post<{ Params: { organizationId: string; userId: string } }>(
    "/platform/organizations/:organizationId/admins/:userId/revoke-sessions",
    { preHandler: requirePlatform },
    async (request, reply) => {
      await write(async () => {
        await repository.revokeTenantUserSessions(
          request.params.organizationId,
          request.params.userId,
        );
        await service.audit(actor(request).id, "TENANT_ADMIN_SESSIONS_REVOKED", "User", request.params.userId, {
          organizationId: request.params.organizationId,
        });
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/platform/audit-logs",
    { preHandler: requirePlatform },
    async (request) => {
      const parsed = Number(request.query.limit ?? 100);
      const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 500) : 100;
      return { data: await repository.listPlatformAudits(limit) };
    },
  );
}
