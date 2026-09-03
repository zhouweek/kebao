import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPasswordForDevelopment } from "../src/auth.js";
import { MemoryRepository } from "../src/memory-repository.js";

const apps: ReturnType<typeof buildApp>[] = [];

function createApp(options: { inactive?: boolean; openId?: string } = {}) {
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
});

describe("微信登录", () => {
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
