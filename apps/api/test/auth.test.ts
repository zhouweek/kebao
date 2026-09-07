import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  AuthService,
  hashPasswordForDevelopment,
  verifyPassword,
} from "../src/auth.js";
import { MemoryRepository } from "../src/memory-repository.js";

const apps: ReturnType<typeof buildApp>[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class TenantLoginRaceRepository extends MemoryRepository {
  readonly findStarted = deferred();
  readonly releaseFind = deferred();
  private transactionCalls = 0;

  override async findAuthUserByOrganizationCodeAndPhone(
    organizationCode: string,
    phone: string,
    role?: "ADMIN" | "TEACHER" | "GUARDIAN",
  ) {
    const user = await super.findAuthUserByOrganizationCodeAndPhone(
      organizationCode,
      phone,
      role,
    );
    this.findStarted.resolve();
    await this.releaseFind.promise;
    return user;
  }

  override async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    if (this.transactionCalls === 2) this.releaseFind.resolve();
    return super.withTransaction(action);
  }

  override async resetPlatformTenantAdminPassword(
    organizationId: string,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await super.resetPlatformTenantAdminPassword(organizationId, userId, passwordHash);
    this.releaseFind.resolve();
  }
}

class WechatLoginRaceRepository extends MemoryRepository {
  readonly firstFindStarted = deferred();
  readonly releaseFirstFind = deferred();
  private transactionCalls = 0;
  private findCalls = 0;

  override async findAuthUserByOrganizationCodeAndPhone(
    organizationCode: string,
    phone: string,
    role?: "ADMIN" | "TEACHER" | "GUARDIAN",
  ) {
    const user = await super.findAuthUserByOrganizationCodeAndPhone(
      organizationCode,
      phone,
      role,
    );
    this.findCalls += 1;
    if (this.findCalls === 1) {
      this.firstFindStarted.resolve();
      await this.releaseFirstFind.promise;
    }
    return user;
  }

  override async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    if (this.transactionCalls === 2) this.releaseFirstFind.resolve();
    return super.withTransaction(action);
  }
}

class RefreshRaceRepository extends MemoryRepository {
  readonly bothLookupsStarted = deferred();
  private lookupCalls = 0;

  override async getAuthSessionByRefreshTokenHash(hash: string) {
    const session = await super.getAuthSessionByRefreshTokenHash(hash);
    this.lookupCalls += 1;
    if (this.lookupCalls === 2) this.bothLookupsStarted.resolve();
    await this.bothLookupsStarted.promise;
    return session;
  }
}

function createApp(
  options: {
    inactive?: boolean;
    openId?: string;
    demoPhoneLoginEnabled?: boolean;
  } = {},
) {
  const repository = new MemoryRepository({
    organizations: [
      { id: "org-a", code: "ORG-A" },
      { id: "org-b", code: "ORG-B" },
    ],
    users: [
      {
        id: "admin-1",
        organizationId: "org-a",
        role: "ADMIN",
        name: "管理员",
        phone: "13800000001",
        passwordHash: hashPasswordForDevelopment("Admin123!"),
        isActive: !options.inactive,
      },
      {
        id: "admin-b",
        organizationId: "org-b",
        role: "ADMIN",
        name: "另一机构管理员",
        phone: "13800000001",
        passwordHash: hashPasswordForDevelopment("Other123!"),
      },
      {
        id: "guardian-1",
        organizationId: "org-a",
        role: "GUARDIAN",
        name: "学生家长",
        phone: "13800000002",
        ...(options.openId ? { wechatOpenId: options.openId } : {}),
      },
    ],
  });
  const app = buildApp(repository, {
    tokenSecret: "test-secret-that-is-long-enough",
    wechatIdentityResolver: async (loginCode, phoneCode) => ({
      openId: `openid-${loginCode}`,
      phone: phoneCode === "phone-code" ? "13800000002" : "invalid",
    }),
    wechatOpenIdResolver: async (loginCode) => `openid-${loginCode}`,
    ...(options.demoPhoneLoginEnabled !== undefined
      ? { wechatDemoPhoneLoginEnabled: options.demoPhoneLoginEnabled }
      : {}),
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("管理员认证与 Bearer 会话", () => {
  it("手机号密码登录后可通过 Bearer 获取本人信息", async () => {
    const app = createApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Admin123!",
      },
    });

    expect(login.statusCode).toBe(200);
    expect(login.json().data).toMatchObject({
      accessTokenExpiresIn: 900,
      user: { id: "admin-1", role: "ADMIN", organizationId: "org-a" },
    });

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${login.json().data.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.name).toBe("管理员");
  });

  it("拒绝错误密码和已停用用户", async () => {
    const app = createApp();
    const invalid = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "wrong-password",
      },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.code).toBe("INVALID_CREDENTIALS");

    const inactiveApp = createApp({ inactive: true });
    const inactive = await inactiveApp.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Admin123!",
      },
    });
    expect(inactive.statusCode).toBe(403);
    expect(inactive.json().error.code).toBe("USER_DISABLED");
  });

  it("刷新时轮换 refresh token，登出后访问令牌立即失效", async () => {
    const app = createApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Admin123!",
      },
    });
    const first = login.json().data;

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.refreshToken).not.toBe(first.refreshToken);

    const reused = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: first.refreshToken },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.code).toBe("REFRESH_TOKEN_INVALID");

    const accessToken = refreshed.json().data.accessToken as string;
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe("SESSION_INVALID");
  });

  it("[defect-probing] 服务层并发复用同一 refresh token 时仅一个成功", async () => {
    const repository = new RefreshRaceRepository({
      organizations: [{ id: "org-a", code: "ORG-A" }],
      users: [
        {
          id: "admin-1",
          organizationId: "org-a",
          role: "ADMIN",
          name: "管理员",
          phone: "13800000001",
          passwordHash: hashPasswordForDevelopment("Admin123!"),
        },
      ],
    });
    const service = new AuthService(repository, {
      tokenSecret: "test-secret-that-is-long-enough",
    });
    const { tokens } = await service.loginAdmin("ORG-A", "13800000001", "Admin123!");

    const results = await Promise.allSettled([
      service.refresh(tokens.refreshToken),
      service.refresh(tokens.refreshToken),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<AuthService["refresh"]>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "REFRESH_TOKEN_INVALID" });
    await expect(service.authenticate(fulfilled[0]!.value.accessToken)).resolves.toMatchObject({
      id: "admin-1",
    });
  });

  it("[defect-probing] API 并发刷新失败响应不提供可用 access token", async () => {
    const repository = new RefreshRaceRepository({
      organizations: [{ id: "org-a", code: "ORG-A" }],
      users: [
        {
          id: "admin-1",
          organizationId: "org-a",
          role: "ADMIN",
          name: "管理员",
          phone: "13800000001",
          passwordHash: hashPasswordForDevelopment("Admin123!"),
        },
      ],
    });
    const app = buildApp(repository, {
      tokenSecret: "test-secret-that-is-long-enough",
    });
    apps.push(app);
    const login = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Admin123!",
      },
    });
    const refreshToken = login.json().data.refreshToken as string;

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken },
      }),
      app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken },
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    const rejected = responses.find((response) => response.statusCode === 401)!;
    expect(rejected.json().error.code).toBe("REFRESH_TOKEN_INVALID");
    expect(rejected.json().data?.accessToken).toBeUndefined();
    const unusable = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: {
        authorization: `Bearer ${rejected.json().data?.accessToken ?? "missing"}`,
      },
    });
    expect(unusable.statusCode).toBe(401);
  });

  it("[defect-probing] 拒绝将租户管理员密码修改为当前密码", async () => {
    const app = createApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Admin123!",
      },
    });

    const changed = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { authorization: `Bearer ${login.json().data.accessToken}` },
      payload: { currentPassword: "Admin123!", newPassword: "Admin123!" },
    });

    expect(changed.statusCode).toBe(400);
    expect(changed.json().error.code).toBe("NEW_PASSWORD_MUST_DIFFER");
  });

  it("[defect-probing] 租户密码被并发重置后旧改密请求不得覆盖新密码", async () => {
    const repository = new MemoryRepository({
      organizations: [{ id: "org-a", code: "ORG-A" }],
      users: [
        {
          id: "admin-1",
          organizationId: "org-a",
          role: "ADMIN",
          name: "管理员",
          phone: "13800000001",
          passwordHash: hashPasswordForDevelopment("Admin123!"),
        },
      ],
    });
    const service = new AuthService(repository, {
      tokenSecret: "test-secret-that-is-long-enough",
    });
    const staleUser = await repository.getAuthUser("admin-1", "org-a");
    const resetPasswordHash = hashPasswordForDevelopment("Reset123!");
    await repository.resetPlatformTenantAdminPassword(
      "org-a",
      "admin-1",
      resetPasswordHash,
    );

    await expect(
      service.changePassword(staleUser!, "Admin123!", "Changed123!"),
    ).rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID" });
    const current = await repository.getAuthUser("admin-1", "org-a");
    expect(await verifyPassword("Reset123!", current!.passwordHash!)).toBe(true);
  });

  it("[defect-probing] 租户旧密码登录与重置串行且不得补发有效会话", async () => {
    const repository = new TenantLoginRaceRepository({
      organizations: [{ id: "org-a", code: "ORG-A" }],
      users: [
        {
          id: "admin-1",
          organizationId: "org-a",
          role: "ADMIN",
          name: "管理员",
          phone: "13800000001",
          passwordHash: hashPasswordForDevelopment("Admin123!"),
        },
      ],
    });
    const service = new AuthService(repository, {
      tokenSecret: "test-secret-that-is-long-enough",
    });
    const loginPromise = service.loginAdmin("ORG-A", "13800000001", "Admin123!");
    await repository.findStarted.promise;
    const resetPromise = repository.withTransaction(() =>
      repository.resetPlatformTenantAdminPassword(
        "org-a",
        "admin-1",
        hashPasswordForDevelopment("Reset123!"),
      ),
    );

    const [{ tokens }] = await Promise.all([loginPromise, resetPromise]);
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
  });
});

describe("微信登录", () => {
  it("个人主体演示登录按预建手机号匹配并绑定微信身份", async () => {
    const app = createApp({ demoPhoneLoginEnabled: true });
    const response = await app.inject({
      method: "POST",
      url: "/auth/wechat/demo-login",
      payload: {
        organizationCode: "ORG-A",
        loginCode: "demo-code",
        phone: "13800000002",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user).toMatchObject({
      id: "guardian-1",
      role: "GUARDIAN",
      phone: "13800000002",
    });
  });

  it("未启用时拒绝个人主体演示登录", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/wechat/demo-login",
      payload: {
        organizationCode: "ORG-A",
        loginCode: "demo-code",
        phone: "13800000002",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("WECHAT_DEMO_LOGIN_DISABLED");
  });

  it("服务端换取 openid 和手机号后按机构匹配并绑定非管理员用户", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/wechat/login",
      payload: {
        organizationCode: "ORG-A",
        loginCode: "code-a",
        phoneCode: "phone-code",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.user).toMatchObject({
      id: "guardian-1",
      role: "GUARDIAN",
    });
    expect(response.json().data.accessToken).toEqual(expect.any(String));
  });

  it("拒绝已绑定到其他微信身份的手机号", async () => {
    const app = createApp({ openId: "openid-original" });
    const response = await app.inject({
      method: "POST",
      url: "/auth/wechat/login",
      payload: {
        organizationCode: "ORG-A",
        loginCode: "other",
        phoneCode: "phone-code",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("WECHAT_IDENTITY_MISMATCH");
  });

  it("并发使用不同微信身份登录同一租户账号时仅首次绑定并创建会话", async () => {
    const repository = new WechatLoginRaceRepository({
      organizations: [{ id: "org-a", code: "ORG-A" }],
      users: [
        {
          id: "guardian-1",
          organizationId: "org-a",
          role: "GUARDIAN",
          name: "学生家长",
          phone: "13800000002",
        },
      ],
    });
    const service = new AuthService(repository, {
      tokenSecret: "test-secret-that-is-long-enough",
    });

    const firstLogin = service.loginWechat("ORG-A", "13800000002", "openid-first");
    await repository.firstFindStarted.promise;
    const secondLogin = service.loginWechat("ORG-A", "13800000002", "openid-second");
    const results = await Promise.allSettled([firstLogin, secondLogin]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { code: "WECHAT_IDENTITY_MISMATCH" },
    });
    const user = await repository.getAuthUser("guardian-1", "org-a");
    expect(user?.wechatOpenId).toBe("openid-first");
    if (results[0].status === "fulfilled") {
      await expect(
        service.authenticate(results[0].value.tokens.accessToken),
      ).resolves.toMatchObject({ id: "guardian-1" });
    }
  });

  it("拒绝客户端手输手机号字段和错误机构编码", async () => {
    const app = createApp();
    const manualPhone = await app.inject({
      method: "POST",
      url: "/auth/wechat/login",
      payload: {
        organizationCode: "ORG-A",
        loginCode: "code-a",
        phoneCode: "phone-code",
        phone: "13800000002",
      },
    });
    expect(manualPhone.statusCode).toBe(400);

    const wrongOrganization = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-B",
        phone: "13800000001",
        password: "Admin123!",
      },
    });
    expect(wrongOrganization.statusCode).toBe(401);
  });
});
