import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changePlatformPassword,
  clearPlatformAuth,
  getPlatformMe,
  listOrganizationAdmins,
  listOrganizations,
  listPlatformAuditLogs,
  loginPlatform,
  refreshPlatformAccessToken,
  resetOrganizationAdminPassword,
  revokeOrganizationAdminSessions,
  saveOrganization,
  saveOrganizationAdmin,
  setOrganizationActive,
  setOrganizationAdminActive,
} from "../src/platform-api";

const user = {
  id: "platform-1",
  username: "root",
  name: "平台管理员",
  isActive: true,
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("platform API client", () => {
  beforeEach(() => {
    localStorage.clear();
    clearPlatformAuth();
    localStorage.setItem("kebao.admin.auth", JSON.stringify({ accessToken: "tenant-token" }));
  });

  it("使用独立存储登录，且不覆盖机构后台 token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: {
        accessToken: "platform-access",
        refreshToken: "platform-refresh",
        accessTokenExpiresIn: 900,
        account: user,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await loginPlatform("root", "Platform123!", fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith("/platform/auth/login", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ username: "root", password: "Platform123!" }),
    }));
    expect(JSON.parse(localStorage.getItem("kebao.platform.auth")!)).toMatchObject({
      accessToken: "platform-access",
    });
    expect(JSON.parse(localStorage.getItem("kebao.admin.auth")!)).toEqual({
      accessToken: "tenant-token",
    });
  });

  it("平台 token 过期后通过平台刷新接口重试", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/platform/auth/refresh") {
        return new Response(JSON.stringify({
          data: {
            accessToken: "new-access",
            refreshToken: "new-refresh",
            accessTokenExpiresIn: 900,
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (fetcher.mock.calls.filter(([url]) => url === "/platform/auth/me").length === 1) {
        return new Response(JSON.stringify({
          error: { code: "TOKEN_EXPIRED", message: "访问令牌已过期" },
        }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer new-access");
      return new Response(JSON.stringify({ data: user }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(getPlatformMe(fetcher as typeof fetch)).resolves.toEqual(user);
    expect(fetcher).toHaveBeenCalledWith(
      "/platform/auth/refresh",
      expect.objectContaining({ body: JSON.stringify({ refreshToken: "old-refresh" }) }),
    );
  });

  it("旧刷新响应不会覆盖新的登录状态", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshPromise = refreshPlatformAccessToken(
      vi.fn(async () => refreshResponse) as unknown as typeof fetch,
    );
    const newUser = { ...user, id: "platform-2", username: "new-root" };
    await loginPlatform("new-root", "NewPassword123!", vi.fn(async () => new Response(JSON.stringify({
      data: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        accessTokenExpiresIn: 900,
        account: newUser,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch);

    resolveRefresh(new Response(JSON.stringify({
      data: {
        accessToken: "stale-refreshed-access",
        refreshToken: "stale-refreshed-refresh",
        accessTokenExpiresIn: 900,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await refreshPromise;

    expect(JSON.parse(localStorage.getItem("kebao.platform.auth")!)).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      account: newUser,
    });
  });

  it("跨标签页替换凭证后旧刷新不重试，也不清除新会话", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const refresh = deferred<Response>();
    let meRequests = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/platform/auth/me") {
        meRequests += 1;
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer old-access");
        return new Response(JSON.stringify({
          error: { code: "TOKEN_EXPIRED", message: "访问令牌已过期" },
        }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      if (input === "/platform/auth/refresh") return refresh.promise;
      throw new Error(`unexpected request: ${String(input)}`);
    });
    const oldRequest = getPlatformMe(fetcher as typeof fetch);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/platform/auth/refresh",
      expect.objectContaining({ body: JSON.stringify({ refreshToken: "old-refresh" }) }),
    ));

    const newUser = { ...user, id: "platform-2", username: "new-root" };
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresIn: 900,
      account: newUser,
    }));
    refresh.resolve(response({
      accessToken: "stale-refreshed-access",
      refreshToken: "stale-refreshed-refresh",
      accessTokenExpiresIn: 900,
    }));

    await expect(oldRequest).rejects.toMatchObject({ code: "TOKEN_EXPIRED", status: 401 });
    expect(meRequests).toBe(1);
    expect(JSON.parse(localStorage.getItem("kebao.platform.auth")!)).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      account: newUser,
    });
  });

  it("退出后旧刷新响应不会恢复认证状态", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    let resolveRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshPromise = refreshPlatformAccessToken(
      vi.fn(async () => refreshResponse) as unknown as typeof fetch,
    );

    clearPlatformAuth();
    resolveRefresh(new Response(JSON.stringify({
      data: {
        accessToken: "stale-refreshed-access",
        refreshToken: "stale-refreshed-refresh",
        accessTokenExpiresIn: 900,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await refreshPromise;

    expect(localStorage.getItem("kebao.platform.auth")).toBeNull();
  });

  it("非 TOKEN_EXPIRED 的 401 会清除平台认证并通知页面", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "invalid-access",
      refreshToken: "invalid-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const authExpired = vi.fn();
    window.addEventListener("kebao:platform-auth-cleared", authExpired);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { code: "TOKEN_INVALID", message: "登录凭证无效" },
    }), { status: 401, headers: { "Content-Type": "application/json" } }));

    await expect(getPlatformMe(fetcher as typeof fetch)).rejects.toMatchObject({
      code: "TOKEN_INVALID",
      status: 401,
    });

    expect(localStorage.getItem("kebao.platform.auth")).toBeNull();
    expect(authExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener("kebao:platform-auth-cleared", authExpired);
  });

  it("按平台接口管理机构和管理员", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const organization = { id: "org-1", code: "DEMO", name: "示例机构", isActive: true };
    const admin = {
      id: "admin-1",
      organizationId: "org-1",
      name: "林校长",
      phone: "13800000001",
      isActive: true,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      let data: unknown = undefined;
      if (url === "/platform/organizations" && !init?.method) data = { items: [organization], page: 1, pageSize: 20, total: 1 };
      else if (url.endsWith("/admins") && !init?.method) data = [admin];
      else if (url.endsWith("/reset-password")) {
        data = { temporaryPassword: "ServerTemp123!" };
      } else if (url.endsWith("/revoke-sessions") || init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      } else if (url.endsWith("/admins") && init?.method === "POST") {
        data = { ...admin, temporaryPassword: "CreateTemp123!" };
      } else if (url.startsWith("/platform/audit-logs")) {
        data = [{
          id: "audit-1",
          actorId: "platform-1",
          action: "TENANT_ADMIN_CREATED",
          entityType: "User",
          entityId: "admin-1",
          details: { organizationId: "org-1" },
          createdAt: "2026-09-07T08:00:00.000Z",
        }];
      } else if (url.includes("/admins/")) data = admin;
      else data = organization;
      return new Response(JSON.stringify({ data }), {
        status: init?.method === "POST" ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(listOrganizations(fetcher as typeof fetch)).resolves.toEqual([organization]);
    await saveOrganization({ code: "DEMO", name: "示例机构" }, undefined, fetcher as typeof fetch);
    await setOrganizationActive("org-1", false, fetcher as typeof fetch);
    await expect(listOrganizationAdmins("org-1", fetcher as typeof fetch)).resolves.toEqual([admin]);
    await expect(saveOrganizationAdmin(
      "org-1",
      { name: "林校长", phone: "13800000001" },
      undefined,
      fetcher as typeof fetch,
    )).resolves.toMatchObject({ ...admin, temporaryPassword: "CreateTemp123!" });
    await setOrganizationAdminActive("org-1", "admin-1", false, fetcher as typeof fetch);
    await expect(resetOrganizationAdminPassword(
      "org-1",
      "admin-1",
      fetcher as typeof fetch,
    )).resolves.toEqual({ temporaryPassword: "ServerTemp123!" });
    await expect(listPlatformAuditLogs(50, fetcher as typeof fetch)).resolves.toHaveLength(1);
    await revokeOrganizationAdminSessions("org-1", "admin-1", fetcher as typeof fetch);

    const resetCall = fetcher.mock.calls.find(([url]) => String(url).endsWith("/reset-password"));
    expect(resetCall?.[1]?.body).toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      "/platform/audit-logs?limit=50",
      expect.any(Object),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/platform/organizations/org-1/admins/admin-1/revoke-sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher.mock.calls.every(([, init]) =>
      new Headers(init?.headers).get("Authorization") === "Bearer platform-access"
    )).toBe(true);
  });

  it("通过强制改密接口更新存储中的用户状态", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    await changePlatformPassword("Temp123!", "NewPassword123!", fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith(
      "/platform/auth/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          currentPassword: "Temp123!",
          newPassword: "NewPassword123!",
        }),
      }),
    );
  });
});
