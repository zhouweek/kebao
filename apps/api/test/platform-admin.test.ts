import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPasswordForDevelopment, verifyPassword } from "../src/auth.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { PlatformService } from "../src/platform.js";

const apps: ReturnType<typeof buildApp>[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class PlatformLoginRaceRepository extends MemoryRepository {
  readonly findStarted = deferred();
  readonly releaseFind = deferred();
  private transactionCalls = 0;

  override async findPlatformAccount(username: string) {
    const account = await super.findPlatformAccount(username);
    this.findStarted.resolve();
    await this.releaseFind.promise;
    return account;
  }

  override async withTransaction<T>(action: () => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    if (this.transactionCalls === 2) this.releaseFind.resolve();
    return super.withTransaction(action);
  }

  override async updatePlatformPassword(
    accountId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<boolean> {
    const updated = await super.updatePlatformPassword(
      accountId,
      expectedPasswordHash,
      passwordHash,
      mustChangePassword,
    );
    this.releaseFind.resolve();
    return updated;
  }
}

function createApp(platformMustChangePassword = false) {
  const repository = new MemoryRepository({
    organizations: [{ id: "org-a", code: "ORG-A" }],
    platformAccounts: [
      {
        id: "platform-1",
        username: "root",
        name: "超级管理员",
        passwordHash: hashPasswordForDevelopment("Platform123!"),
        isActive: true,
        mustChangePassword: platformMustChangePassword,
      },
    ],
    users: [
      {
        id: "admin-a",
        organizationId: "org-a",
        role: "ADMIN",
        name: "机构管理员",
        phone: "13800000001",
        passwordHash: hashPasswordForDevelopment("Tenant123!"),
      },
    ],
  });
  const app = buildApp(repository, {
    tokenSecret: "tenant-secret-that-is-long-enough",
    platformTokenSecret: "platform-secret-that-is-different-and-long-enough",
  });
  apps.push(app);
  return app;
}

async function platformLogin(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: "POST",
    url: "/platform/auth/login",
    payload: { username: "root", password: "Platform123!" },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as {
    accessToken: string;
    refreshToken: string;
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("超级管理员平台认证", () => {
  it("[defect-probing] 认证字段先 trim 再校验长度并使用规范化值", async () => {
    const app = createApp();
    const login = await app.inject({
      method: "POST",
      url: "/platform/auth/login",
      payload: { username: " root ", password: " Platform123! " },
    });
    expect(login.statusCode).toBe(200);

    const refreshed = await app.inject({
      method: "POST",
      url: "/platform/auth/refresh",
      payload: { refreshToken: ` ${login.json().data.refreshToken} ` },
    });
    expect(refreshed.statusCode).toBe(200);

    const changed = await app.inject({
      method: "POST",
      url: "/platform/auth/change-password",
      headers: {
        authorization: `Bearer ${refreshed.json().data.accessToken}`,
      },
      payload: {
        currentPassword: " Platform123! ",
        newPassword: " Platform456! ",
      },
    });
    expect(changed.statusCode).toBe(204);

    const relogin = await app.inject({
      method: "POST",
      url: "/platform/auth/login",
      payload: { username: "root", password: "Platform456!" },
    });
    expect(relogin.statusCode).toBe(200);
  });

  it("[defect-probing] 认证字段按 trim 后的有效长度拒绝非法值", async () => {
    const app = createApp();
    const blankUsername = await app.inject({
      method: "POST",
      url: "/platform/auth/login",
      payload: { username: " ", password: "Platform123!" },
    });
    expect(blankUsername.statusCode).toBe(400);
    expect(blankUsername.json().error.code).toBe("VALIDATION_ERROR");

    const login = await platformLogin(app);
    const shortNewPassword = await app.inject({
      method: "POST",
      url: "/platform/auth/change-password",
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: {
        currentPassword: "Platform123!",
        newPassword: " 123456 ",
      },
    });
    expect(shortNewPassword.statusCode).toBe(400);
    expect(shortNewPassword.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("初始平台账号只能访问账号信息、改密和退出，改密后解除限制", async () => {
    const app = createApp(true);
    const login = await platformLogin(app);
    expect((login as typeof login & { account: { mustChangePassword: boolean } }).account)
      .toMatchObject({ mustChangePassword: true });

    const blocked = await app.inject({
      method: "GET",
      url: "/platform/organizations",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const me = await app.inject({
      method: "GET",
      url: "/platform/auth/me",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.mustChangePassword).toBe(true);

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/platform/auth/change-password",
          headers: { authorization: `Bearer ${login.accessToken}` },
          payload: { currentPassword: "Platform123!", newPassword: "Platform456!" },
        })
      ).statusCode,
    ).toBe(204);

    const relogin = await app.inject({
      method: "POST",
      url: "/platform/auth/login",
      payload: { username: "root", password: "Platform456!" },
    });
    expect(relogin.statusCode).toBe(200);
    expect(relogin.json().data.account.mustChangePassword).toBe(false);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/platform/organizations",
          headers: {
            authorization: `Bearer ${relogin.json().data.accessToken}`,
          },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("登录、刷新、改密并撤销全部平台会话", async () => {
    const app = createApp();
    const login = await platformLogin(app);
    const refreshed = await app.inject({
      method: "POST",
      url: "/platform/auth/refresh",
      payload: { refreshToken: login.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.refreshToken).not.toBe(login.refreshToken);

    const changed = await app.inject({
      method: "POST",
      url: "/platform/auth/change-password",
      headers: { authorization: `Bearer ${refreshed.json().data.accessToken}` },
      payload: { currentPassword: "Platform123!", newPassword: "Platform456!" },
    });
    expect(changed.statusCode).toBe(204);

    const invalidated = await app.inject({
      method: "GET",
      url: "/platform/auth/me",
      headers: { authorization: `Bearer ${refreshed.json().data.accessToken}` },
    });
    expect(invalidated.statusCode).toBe(401);
  });

  it("[defect-probing] 拒绝将平台密码修改为当前密码", async () => {
    const app = createApp(true);
    const login = await platformLogin(app);

    const changed = await app.inject({
      method: "POST",
      url: "/platform/auth/change-password",
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: {
        currentPassword: "Platform123!",
        newPassword: "Platform123!",
      },
    });

    expect(changed.statusCode).toBe(400);
    expect(changed.json().error.code).toBe("NEW_PASSWORD_MUST_DIFFER");
  });

  it("[defect-probing] 平台密码被并发更新后旧改密请求不得覆盖新密码", async () => {
    const repository = new MemoryRepository({
      platformAccounts: [
        {
          id: "platform-1",
          username: "root",
          name: "超级管理员",
          passwordHash: hashPasswordForDevelopment("Platform123!"),
          isActive: true,
        },
      ],
    });
    const service = new PlatformService(repository, "platform-secret");
    const staleAccount = await repository.getPlatformAccount("platform-1");
    const resetPasswordHash = hashPasswordForDevelopment("Reset123!");
    await repository.updatePlatformPassword(
      "platform-1",
      staleAccount!.passwordHash,
      resetPasswordHash,
      true,
    );

    await expect(
      service.changePassword(staleAccount!, "Platform123!", "Changed123!"),
    ).rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID" });
    const current = await repository.getPlatformAccount("platform-1");
    expect(await verifyPassword("Reset123!", current!.passwordHash)).toBe(true);
  });

  it("[defect-probing] 平台旧密码登录与改密串行且不得补发有效会话", async () => {
    const repository = new PlatformLoginRaceRepository({
      platformAccounts: [
        {
          id: "platform-1",
          username: "root",
          name: "超级管理员",
          passwordHash: hashPasswordForDevelopment("Platform123!"),
          isActive: true,
        },
      ],
    });
    const service = new PlatformService(repository, "platform-secret");
    const account = await repository.getPlatformAccount("platform-1");
    const loginPromise = service.login("root", "Platform123!");
    await repository.findStarted.promise;
    const changePromise = service.changePassword(
      account!,
      "Platform123!",
      "Platform456!",
    );

    const [{ tokens }] = await Promise.all([loginPromise, changePromise]);
    await expect(service.authenticate(tokens.accessToken)).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
  });

  it("并发使用同一刷新令牌时仅允许一次原子轮换", async () => {
    const app = createApp();
    const login = await platformLogin(app);
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/platform/auth/refresh",
        payload: { refreshToken: login.refreshToken },
      }),
      app.inject({
        method: "POST",
        url: "/platform/auth/refresh",
        payload: { refreshToken: login.refreshToken },
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
    expect(
      responses.find((response) => response.statusCode === 401)?.json().error.code,
    ).toBe("REFRESH_TOKEN_INVALID");
  });

  it("平台与租户访问令牌不能跨域使用", async () => {
    const app = createApp();
    const platform = await platformLogin(app);
    const tenantLogin = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Tenant123!",
      },
    });

    const tenantAtPlatform = await app.inject({
      method: "GET",
      url: "/platform/auth/me",
      headers: { authorization: `Bearer ${tenantLogin.json().data.accessToken}` },
    });
    const platformAtTenant = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${platform.accessToken}` },
    });
    expect(tenantAtPlatform.statusCode).toBe(401);
    expect(platformAtTenant.statusCode).toBe(401);
  });
});

describe("平台机构与机构管理员管理", () => {
  it("[defect-probing] 机构与管理员字段按 trim 后的边界校验并持久化规范化值", async () => {
    const app = createApp();
    const { accessToken } = await platformLogin(app);
    const headers = { authorization: `Bearer ${accessToken}` };
    const code = "B".repeat(64);
    const organizationName = "机构".repeat(64);
    const createdOrganization = await app.inject({
      method: "POST",
      url: "/platform/organizations",
      headers,
      payload: {
        code: ` ${code} `,
        name: ` ${organizationName} `,
      },
    });
    expect(createdOrganization.statusCode).toBe(201);
    expect(createdOrganization.json().data).toMatchObject({
      code,
      name: organizationName,
    });

    const adminName = "管".repeat(128);
    const phone = "1".repeat(32);
    const email = `${"e".repeat(242)}@example.com`;
    const createdAdmin = await app.inject({
      method: "POST",
      url: `/platform/organizations/${createdOrganization.json().data.id}/admins`,
      headers,
      payload: {
        name: ` ${adminName} `,
        phone: ` ${phone} `,
        email: ` ${email} `,
      },
    });
    expect(createdAdmin.statusCode).toBe(201);
    expect(createdAdmin.json().data).toMatchObject({
      name: adminName,
      phone,
      email,
    });
  });

  it("[defect-probing] 拒绝 trim 后为空的机构及管理员必填字段", async () => {
    const app = createApp();
    const { accessToken } = await platformLogin(app);
    const headers = { authorization: `Bearer ${accessToken}` };
    const requests = [
      app.inject({
        method: "POST",
        url: "/platform/organizations",
        headers,
        payload: { code: " ", name: "机构 B" },
      }),
      app.inject({
        method: "POST",
        url: "/platform/organizations",
        headers,
        payload: { code: "ORG-B", name: " " },
      }),
      app.inject({
        method: "PATCH",
        url: "/platform/organizations/org-a",
        headers,
        payload: { name: " " },
      }),
      app.inject({
        method: "POST",
        url: "/platform/organizations/org-a/admins",
        headers,
        payload: { name: " ", phone: "13800000002" },
      }),
      app.inject({
        method: "POST",
        url: "/platform/organizations/org-a/admins",
        headers,
        payload: { name: "新管理员", phone: "      " },
      }),
      app.inject({
        method: "PATCH",
        url: "/platform/organizations/org-a/admins/admin-a",
        headers,
        payload: { name: " " },
      }),
    ];

    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.statusCode)).toEqual([
      400, 400, 400, 400, 400, 400,
    ]);
    for (const response of responses) {
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("[defect-probing] 管理员手机号按 trim 后的值校验 6 到 32 位", async () => {
    const app = createApp();
    const { accessToken } = await platformLogin(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    const tooShort = await app.inject({
      method: "POST",
      url: "/platform/organizations/org-a/admins",
      headers,
      payload: { name: "短号码", phone: " 1234 " },
    });
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.json().error.code).toBe("VALIDATION_ERROR");

    const normalized = "12345678901234567890123456789012";
    const accepted = await app.inject({
      method: "POST",
      url: "/platform/organizations/org-a/admins",
      headers,
      payload: { name: "边界号码", phone: ` ${normalized} ` },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().data.phone).toBe(normalized);

    const tooShortUpdate = await app.inject({
      method: "PATCH",
      url: `/platform/organizations/org-a/admins/${accepted.json().data.id}`,
      headers,
      payload: { phone: " 1234 " },
    });
    expect(tooShortUpdate.statusCode).toBe(400);
    expect(tooShortUpdate.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("平台写入与审计失败时由内存事务完整回滚", async () => {
    const repository = new MemoryRepository({
      platformAccounts: [
        {
          id: "platform-1",
          username: "root",
          name: "超级管理员",
          passwordHash: hashPasswordForDevelopment("Platform123!"),
          isActive: true,
          mustChangePassword: false,
        },
      ],
    });
    const app = buildApp(repository, {
      tokenSecret: "tenant-secret-that-is-long-enough",
      platformTokenSecret: "platform-secret-that-is-different-and-long-enough",
    });
    apps.push(app);
    const { accessToken } = await platformLogin(app);
    repository.savePlatformAudit = async () => {
      throw new Error("audit unavailable");
    };

    const response = await app.inject({
      method: "POST",
      url: "/platform/organizations",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code: "ROLLBACK", name: "不应保留" },
    });

    expect(response.statusCode).toBe(500);
    expect(
      (await repository.listPlatformOrganizations()).some(
        (organization) => organization.code === "ROLLBACK",
      ),
    ).toBe(false);
  });

  it("状态变更或密码重置审计失败时同时回滚会话撤销", async () => {
    const repository = new MemoryRepository({
      organizations: [{ id: "org-a", code: "ORG-A" }],
      platformAccounts: [
        {
          id: "platform-1",
          username: "root",
          name: "超级管理员",
          passwordHash: hashPasswordForDevelopment("Platform123!"),
          isActive: true,
          mustChangePassword: false,
        },
      ],
      users: [
        {
          id: "admin-a",
          organizationId: "org-a",
          role: "ADMIN",
          name: "机构管理员",
          phone: "13800000001",
          passwordHash: hashPasswordForDevelopment("Tenant123!"),
        },
      ],
    });
    const app = buildApp(repository, {
      tokenSecret: "tenant-secret-that-is-long-enough",
      platformTokenSecret: "platform-secret-that-is-different-and-long-enough",
    });
    apps.push(app);
    const platform = await platformLogin(app);
    const tenant = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Tenant123!",
      },
    });
    repository.savePlatformAudit = async () => {
      throw new Error("audit unavailable");
    };
    const headers = { authorization: `Bearer ${platform.accessToken}` };

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/platform/organizations/org-a/admins/admin-a/status",
          headers,
          payload: { isActive: false },
        })
      ).statusCode,
    ).toBe(500);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/platform/organizations/org-a/admins/admin-a/reset-password",
          headers,
        })
      ).statusCode,
    ).toBe(500);

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/me",
          headers: { authorization: `Bearer ${tenant.json().data.accessToken}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/admin/login",
          payload: {
            organizationCode: "ORG-A",
            phone: "13800000001",
            password: "Tenant123!",
          },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("停用机构后立即拒绝该租户已有会话", async () => {
    const app = createApp();
    const platform = await platformLogin(app);
    const tenantLogin = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000001",
        password: "Tenant123!",
      },
    });
    expect(tenantLogin.statusCode).toBe(200);

    const disabled = await app.inject({
      method: "PATCH",
      url: "/platform/organizations/org-a/status",
      headers: { authorization: `Bearer ${platform.accessToken}` },
      payload: { isActive: false },
    });
    expect(disabled.statusCode).toBe(200);

    const tenantRequest = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${tenantLogin.json().data.accessToken}` },
    });
    expect(tenantRequest.statusCode).toBe(401);
    expect(tenantRequest.json().error.code).toBe("SESSION_INVALID");
  });

  it("创建、更新、停用和逻辑删除机构，并记录平台审计", async () => {
    const app = createApp();
    const { accessToken } = await platformLogin(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    const created = await app.inject({
      method: "POST",
      url: "/platform/organizations",
      headers,
      payload: { code: "org-b", name: "机构 B" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.code).toBe("ORG-B");
    const id = created.json().data.id as string;

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/platform/organizations/${id}`,
          headers,
          payload: { name: "机构 B2" },
        })
      ).json().data.name,
    ).toBe("机构 B2");
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/platform/organizations/${id}/status`,
          headers,
          payload: { isActive: false },
        })
      ).json().data.isActive,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/platform/organizations/${id}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);

    const listed = await app.inject({
      method: "GET",
      url: "/platform/organizations",
      headers,
    });
    expect(listed.json().data.some((item: { id: string }) => item.id === id)).toBe(false);
    const audits = await app.inject({
      method: "GET",
      url: "/platform/audit-logs",
      headers,
    });
    expect(audits.json().data.map((item: { action: string }) => item.action)).toEqual(
      expect.arrayContaining([
        "ORGANIZATION_CREATED",
        "ORGANIZATION_UPDATED",
        "ORGANIZATION_DISABLED",
        "ORGANIZATION_DELETED",
      ]),
    );
  });

  it("服务端生成一次性临时密码，支持编辑管理员，重置和停用均撤销会话", async () => {
    const app = createApp();
    const platform = await platformLogin(app);
    const headers = { authorization: `Bearer ${platform.accessToken}` };
    const created = await app.inject({
      method: "POST",
      url: "/platform/organizations/org-a/admins",
      headers,
      payload: {
        name: "新管理员",
        phone: "13800000002",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.mustChangePassword).toBe(true);
    expect(created.json().data.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}Aa1!$/);
    const userId = created.json().data.id as string;
    const initialPassword = created.json().data.temporaryPassword as string;

    const rejectedClientPassword = await app.inject({
      method: "POST",
      url: "/platform/organizations/org-a/admins",
      headers,
      payload: {
        name: "非法管理员",
        phone: "13800000003",
        password: "ClientChosen123!",
      },
    });
    expect(rejectedClientPassword.statusCode).toBe(400);

    const edited = await app.inject({
      method: "PATCH",
      url: `/platform/organizations/org-a/admins/${userId}`,
      headers,
      payload: {
        name: "新管理员（已编辑）",
        phone: "13800000012",
        email: "admin@example.com",
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data).toMatchObject({
      name: "新管理员（已编辑）",
      phone: "13800000012",
      email: "admin@example.com",
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000012",
        password: initialPassword,
      },
    });
    const tenantToken = login.json().data.accessToken as string;
    const blocked = await app.inject({
      method: "GET",
      url: "/sessions",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changed = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { authorization: `Bearer ${tenantToken}` },
      payload: { currentPassword: initialPassword, newPassword: "Changed123!" },
    });
    expect(changed.statusCode).toBe(204);

    const relogin = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "ORG-A",
        phone: "13800000012",
        password: "Changed123!",
      },
    });
    expect(relogin.statusCode).toBe(200);

    const rejectedResetPassword = await app.inject({
      method: "POST",
      url: `/platform/organizations/org-a/admins/${userId}/reset-password`,
      headers,
      payload: { password: "ClientChosen123!" },
    });
    expect(rejectedResetPassword.statusCode).toBe(400);

    const reset = await app.inject({
      method: "POST",
      url: `/platform/organizations/org-a/admins/${userId}/reset-password`,
      headers,
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}Aa1!$/);
    expect(reset.json().data.temporaryPassword).not.toBe(initialPassword);
    const revoked = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${relogin.json().data.accessToken}` },
    });
    expect(revoked.statusCode).toBe(401);

    const listed = await app.inject({
      method: "GET",
      url: "/platform/organizations/org-a/admins",
      headers,
    });
    expect(listed.body).not.toContain("temporaryPassword");

    const resetLogin = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: {
        organizationCode: "org-a",
        phone: "13800000012",
        password: reset.json().data.temporaryPassword,
      },
    });
    expect(resetLogin.statusCode).toBe(200);
    expect(resetLogin.json().data.user.mustChangePassword).toBe(true);

    const disabled = await app.inject({
      method: "PATCH",
      url: `/platform/organizations/org-a/admins/${userId}/status`,
      headers,
      payload: { isActive: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().data.isActive).toBe(false);
  });
});
