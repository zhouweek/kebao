import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlatformApp from "../src/PlatformApp";

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

describe("超级管理员界面", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("登录后加载机构和管理员，并将临时密码只展示在一次性弹窗中", async () => {
    const organization = { id: "org-1", code: "DEMO", name: "示例机构", isActive: true };
    const admin = {
      id: "admin-1",
      organizationId: "org-1",
      name: "林校长",
      phone: "13800000001",
      isActive: true,
      mustChangePassword: true,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/platform/auth/login") {
        return response({
          accessToken: "platform-access",
          refreshToken: "platform-refresh",
          accessTokenExpiresIn: 900,
          account: user,
        });
      }
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") return response([organization]);
      if (url.endsWith("/admins") && !init?.method) return response([admin]);
      if (url.endsWith("/admins") && init?.method === "POST") {
        return response({ ...admin, temporaryPassword: "ServerCreate123!" }, 201);
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    fireEvent.change(screen.getByLabelText("账号"), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Platform123!" } });
    fireEvent.click(screen.getByRole("button", { name: "登录平台" }));

    expect(await screen.findByText("示例机构")).toBeInTheDocument();
    expect(await screen.findByText("林校长")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建管理员" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "新管理员" } });
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000002" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const temporaryPassword = (await screen.findByLabelText("临时密码值")).textContent!;
    const createCall = fetcher.mock.calls.find(([url, init]) =>
      String(url).endsWith("/admins") && init?.method === "POST"
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: "新管理员",
      phone: "13800000002",
      email: null,
    });
    expect(temporaryPassword).toBe("ServerCreate123!");
    expect(localStorage.getItem("kebao.platform.auth")).not.toContain(temporaryPassword);
    fireEvent.click(screen.getByRole("button", { name: "我已保存，关闭" }));
    expect(screen.queryByText(temporaryPassword)).not.toBeInTheDocument();
  });

  it("创建管理员先展示临时密码，再等待管理员列表刷新", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const refresh = deferred<Response>();
    let adminLoads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") {
        return response([{ id: "org-1", code: "DEMO", name: "示例机构", isActive: true }]);
      }
      if (url.endsWith("/admins") && init?.method === "POST") {
        return response({
          id: "admin-1",
          organizationId: "org-1",
          name: "新管理员",
          phone: "13800000002",
          isActive: true,
          temporaryPassword: "CreateBeforeRefresh123!",
        }, 201);
      }
      if (url.endsWith("/admins")) {
        adminLoads += 1;
        return adminLoads === 1 ? response([]) : refresh.promise;
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByRole("heading", { name: "机构管理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建管理员" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "新管理员" } });
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000002" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByLabelText("临时密码值")).toHaveTextContent("CreateBeforeRefresh123!");
    refresh.resolve(response([]));
  });

  it("创建管理员提交期间绑定当前机构且禁止关闭或切换", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const create = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") {
        return response([
          { id: "org-a", code: "A", name: "机构 A", isActive: true },
          { id: "org-b", code: "B", name: "机构 B", isActive: true },
        ]);
      }
      if (url.endsWith("/org-a/admins") && init?.method === "POST") return create.promise;
      if (url.endsWith("/admins")) return response([]);
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByText("当前机构：机构 A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建管理员" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "新管理员" } });
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000002" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(fetcher.mock.calls.some(([url, request]) =>
      String(url).endsWith("/org-a/admins") && request?.method === "POST"
    )).toBe(true));
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /机构 B/ })).toBeDisabled();

    create.resolve(response({
      id: "admin-a",
      organizationId: "org-a",
      name: "新管理员",
      phone: "13800000002",
      isActive: true,
      temporaryPassword: "OrgATemporary123!",
    }, 201));
    expect(await screen.findByLabelText("临时密码值")).toHaveTextContent("OrgATemporary123!");
    expect(screen.getByText("当前机构：机构 A")).toBeInTheDocument();
  });

  it("创建管理员的迟到响应不会跨退出和新登录展示", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const create = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/platform/auth/login") {
        return response({
          accessToken: "new-access",
          refreshToken: "new-refresh",
          accessTokenExpiresIn: 900,
          account: { ...user, id: "platform-2", username: "new-root" },
        });
      }
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/auth/logout") return new Response(null, { status: 204 });
      if (url === "/platform/organizations") {
        return response([{ id: "org-1", code: "DEMO", name: "示例机构", isActive: true }]);
      }
      if (url.endsWith("/admins") && init?.method === "POST") return create.promise;
      if (url.endsWith("/admins")) return response([]);
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByRole("heading", { name: "机构管理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建管理员" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "旧会话管理员" } });
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000002" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, request]) =>
      String(url).endsWith("/admins") && request?.method === "POST"
    )).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("heading", { name: "超级管理员登录" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("账号"), { target: { value: "new-root" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "登录平台" }));
    expect(await screen.findByRole("heading", { name: "机构管理" })).toBeInTheDocument();

    create.resolve(response({
      id: "admin-old",
      organizationId: "org-1",
      name: "旧会话管理员",
      phone: "13800000002",
      isActive: true,
      temporaryPassword: "OldSessionCreate123!",
    }, 201));
    await waitFor(() => {
      expect(screen.queryByText("OldSessionCreate123!")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("临时密码值")).not.toBeInTheDocument();
    });
    expect(JSON.parse(localStorage.getItem("kebao.platform.auth")!)).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
  });

  it("跨标签换号时立即清空旧界面，并只用新 token 重新加载身份与数据", async () => {
    const oldAuth = {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    };
    const newUser = { ...user, id: "platform-2", username: "new-root", name: "新平台管理员" };
    const newAuth = {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresIn: 900,
      account: newUser,
    };
    localStorage.setItem("kebao.platform.auth", JSON.stringify(oldAuth));
    const oldCreate = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const token = new Headers(init?.headers).get("Authorization");
      if (url === "/platform/auth/me") {
        return response(token === "Bearer new-access" ? newUser : user);
      }
      if (url === "/platform/organizations") {
        return response(token === "Bearer new-access"
          ? [{ id: "org-new", code: "NEW", name: "新账号机构", isActive: true }]
          : [{ id: "org-old", code: "OLD", name: "旧账号机构", isActive: true }]);
      }
      if (url.endsWith("/org-old/admins") && init?.method === "POST") return oldCreate.promise;
      if (url.endsWith("/org-old/admins")) {
        return response([{
          id: "admin-old",
          organizationId: "org-old",
          name: "旧账号管理员",
          phone: "13800000001",
          isActive: true,
        }]);
      }
      if (url.endsWith("/org-new/admins")) {
        return response([{
          id: "admin-new",
          organizationId: "org-new",
          name: "新账号管理员",
          phone: "13800000002",
          isActive: true,
        }]);
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByText("旧账号管理员")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建管理员" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "旧会话新管理员" } });
    fireEvent.change(screen.getByLabelText("手机号"), { target: { value: "13800000003" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) =>
      String(url).endsWith("/org-old/admins") && init?.method === "POST"
    )).toBe(true));

    const callsBeforeSwitch = fetcher.mock.calls.length;
    localStorage.setItem("kebao.platform.auth", JSON.stringify(newAuth));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "kebao.platform.auth",
        oldValue: JSON.stringify(oldAuth),
        newValue: JSON.stringify(newAuth),
      }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("旧账号管理员")).not.toBeInTheDocument();
    expect(await screen.findByText("新账号管理员")).toBeInTheDocument();
    expect(screen.getByText("新平台管理员")).toBeInTheDocument();
    const callsAfterSwitch = fetcher.mock.calls.slice(callsBeforeSwitch)
      .filter(([url]) => String(url).startsWith("/platform/"));
    expect(callsAfterSwitch.length).toBeGreaterThan(0);
    for (const [, init] of callsAfterSwitch) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer new-access");
    }

    oldCreate.resolve(response({
      id: "admin-created-by-old-account",
      organizationId: "org-old",
      name: "旧会话新管理员",
      phone: "13800000003",
      isActive: true,
      temporaryPassword: "MustNotLeak123!",
    }, 201));
    await waitFor(() => {
      expect(screen.queryByText("MustNotLeak123!")).not.toBeInTheDocument();
      expect(screen.getByText("新账号管理员")).toBeInTheDocument();
    });
  });

  it("其他标签退出时立即关闭弹窗、清空管理数据并回到登录页", async () => {
    const auth = {
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    };
    localStorage.setItem("kebao.platform.auth", JSON.stringify(auth));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/platform/auth/me") return response(user);
      if (input === "/platform/organizations") {
        return response([{ id: "org-1", code: "DEMO", name: "待清空机构", isActive: true }]);
      }
      if (String(input).endsWith("/admins")) {
        return response([{
          id: "admin-1",
          organizationId: "org-1",
          name: "待清空管理员",
          phone: "13800000001",
          isActive: true,
        }]);
      }
      return response({});
    }));

    render(<PlatformApp />);
    expect(await screen.findByText("待清空管理员")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建管理员" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    localStorage.removeItem("kebao.platform.auth");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "kebao.platform.auth",
        oldValue: JSON.stringify(auth),
        newValue: null,
      }));
    });

    expect(screen.getByRole("heading", { name: "超级管理员登录" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("登录状态已在其他标签页变更，请重新登录");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("待清空机构")).not.toBeInTheDocument();
    expect(screen.queryByText("待清空管理员")).not.toBeInTheDocument();
  });

  it("重置密码不提交请求体并展示服务端临时密码", async () => {
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
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") return response([organization]);
      if (url.endsWith("/reset-password")) {
        return response({ temporaryPassword: "ServerReset123!" });
      }
      if (url.endsWith("/admins")) return response([admin]);
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<PlatformApp />);
    expect(await screen.findByText("林校长")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    expect(await screen.findByLabelText("临时密码值")).toHaveTextContent("ServerReset123!");
    const resetCall = fetcher.mock.calls.find(([url]) => String(url).endsWith("/reset-password"));
    expect(resetCall?.[1]?.body).toBeUndefined();
  });

  it("跨标签换号后丢弃旧密码重置响应且不刷新管理员列表", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const reset = deferred<Response>();
    let adminLoads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") {
        return response([{ id: "org-1", code: "DEMO", name: "示例机构", isActive: true }]);
      }
      if (url.endsWith("/reset-password")) return reset.promise;
      if (url.endsWith("/admins")) {
        adminLoads += 1;
        return response([{
          id: "admin-1",
          organizationId: "org-1",
          name: "林校长",
          phone: "13800000001",
          isActive: true,
        }]);
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<PlatformApp />);
    expect(await screen.findByText("林校长")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) =>
      String(url).endsWith("/reset-password")
    )).toBe(true));

    const newUser = { ...user, id: "platform-2", username: "new-root" };
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresIn: 900,
      account: newUser,
    }));
    await act(async () => {
      reset.resolve(response({ temporaryPassword: "OldTabReset123!" }));
      await reset.promise;
    });

    expect(screen.queryByText("OldTabReset123!")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("临时密码值")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重置密码" })).toBeEnabled();
    expect(adminLoads).toBe(1);
    expect(JSON.parse(localStorage.getItem("kebao.platform.auth")!)).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      account: newUser,
    });
  });

  it("机构切换后立即清表，且旧管理员请求不能覆盖当前机构", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const organizations = [
      { id: "org-a", code: "A", name: "机构 A", isActive: true },
      { id: "org-b", code: "B", name: "机构 B", isActive: true },
    ];
    const firstA = deferred<Response>();
    const firstB = deferred<Response>();
    let aRequests = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") return response(organizations);
      if (url.endsWith("/org-a/admins")) {
        aRequests += 1;
        if (aRequests === 1) return response([{
          id: "admin-a-visible",
          organizationId: "org-a",
          name: "机构 A 已有管理员",
          phone: "13800000001",
          isActive: true,
        }]);
        return firstA.promise;
      }
      if (url.endsWith("/org-b/admins")) return firstB.promise.then((result) => result.clone());
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByText("机构 A 已有管理员")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /机构 B/ }));
    expect(screen.queryByText("机构 A 已有管理员")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /机构 A/ }));
    fireEvent.click(screen.getByRole("button", { name: /机构 B/ }));
    firstB.resolve(response([{
      id: "admin-b",
      organizationId: "org-b",
      name: "机构 B 管理员",
      phone: "13800000002",
      isActive: true,
    }]));
    expect(await screen.findByText("机构 B 管理员")).toBeInTheDocument();

    firstA.resolve(response([{
      id: "admin-a-late",
      organizationId: "org-a",
      name: "迟到的机构 A 管理员",
      phone: "13800000003",
      isActive: true,
    }]));
    await waitFor(() => {
      expect(screen.queryByText("迟到的机构 A 管理员")).not.toBeInTheDocument();
      expect(screen.getByText("机构 B 管理员")).toBeInTheDocument();
    });
  });

  it("管理员重置密码使用单飞锁，禁止重复点击", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const reset = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") {
        return response([{ id: "org-1", code: "DEMO", name: "示例机构", isActive: true }]);
      }
      if (url.endsWith("/reset-password")) return reset.promise;
      if (url.endsWith("/admins")) {
        return response([{
          id: "admin-1",
          organizationId: "org-1",
          name: "林校长",
          phone: "13800000001",
          isActive: true,
        }]);
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<PlatformApp />);
    expect(await screen.findByText("林校长")).toBeInTheDocument();
    const resetButton = screen.getByRole("button", { name: "重置密码" });
    fireEvent.click(resetButton);
    fireEvent.click(resetButton);

    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/reset-password"))).toHaveLength(1);
    expect(resetButton).toBeDisabled();
    reset.resolve(response({ temporaryPassword: "ServerReset123!" }));
    expect(await screen.findByLabelText("临时密码值")).toHaveTextContent("ServerReset123!");
  });

  it("重置期间禁止切换机构，并始终展示服务端返回的临时密码", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const reset = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/organizations") {
        return response([
          { id: "org-a", code: "A", name: "机构 A", isActive: true },
          { id: "org-b", code: "B", name: "机构 B", isActive: true },
        ]);
      }
      if (url.endsWith("/reset-password")) return reset.promise;
      if (url.endsWith("/org-a/admins")) {
        return response([{ id: "admin-a", organizationId: "org-a", name: "管理员 A", phone: "1", isActive: true }]);
      }
      if (url.endsWith("/org-b/admins")) {
        return response([{ id: "admin-b", organizationId: "org-b", name: "管理员 B", phone: "2", isActive: true }]);
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<PlatformApp />);
    expect(await screen.findByText("管理员 A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    const organizationBButton = screen.getByRole("button", { name: /机构 B/ });
    expect(organizationBButton).toBeDisabled();
    fireEvent.click(organizationBButton);
    expect(screen.getByText("管理员 A")).toBeInTheDocument();
    expect(screen.queryByText("管理员 B")).not.toBeInTheDocument();

    reset.resolve(response({ temporaryPassword: "StalePassword123!" }));
    expect(await screen.findByLabelText("临时密码值")).toHaveTextContent("StalePassword123!");
    expect(screen.getByText("管理员 A")).toBeInTheDocument();
  });

  it("退出后旧密码重置响应不会跨会话展示", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const reset = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/platform/auth/login") {
        return response({
          accessToken: "new-access",
          refreshToken: "new-refresh",
          accessTokenExpiresIn: 900,
          account: user,
        });
      }
      if (url === "/platform/auth/me") return response(user);
      if (url === "/platform/auth/logout") return new Response(null, { status: 204 });
      if (url === "/platform/organizations") {
        return response([{ id: "org-1", code: "DEMO", name: "示例机构", isActive: true }]);
      }
      if (url.endsWith("/reset-password")) return reset.promise;
      if (url.endsWith("/admins")) {
        return response([{
          id: "admin-1",
          organizationId: "org-1",
          name: "林校长",
          phone: "13800000001",
          isActive: true,
        }]);
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<PlatformApp />);
    expect(await screen.findByText("林校长")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByRole("heading", { name: "超级管理员登录" })).toBeInTheDocument();

    reset.resolve(response({ temporaryPassword: "OldSessionReset123!" }));
    await waitFor(() => expect(screen.queryByText("OldSessionReset123!")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("账号"), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "登录平台" }));

    expect(await screen.findByRole("heading", { name: "机构管理" })).toBeInTheDocument();
    expect(screen.queryByLabelText("临时密码值")).not.toBeInTheDocument();
  });

  it("平台接口返回非过期 401 时回到登录页", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/platform/auth/me") return response(user);
      return new Response(JSON.stringify({
        error: { code: "TOKEN_INVALID", message: "登录凭证无效" },
      }), { status: 401, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);

    expect(await screen.findByRole("heading", { name: "超级管理员登录" })).toBeInTheDocument();
    expect(localStorage.getItem("kebao.platform.auth")).toBeNull();
  });

  it("首次平台登录强制修改密码，不加载管理数据", async () => {
    const forcedUser = { ...user, mustChangePassword: true };
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: forcedUser,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/platform/auth/me") return response(forcedUser);
      if (input === "/platform/auth/change-password" || input === "/platform/auth/logout") {
        return new Response(null, { status: 204 });
      }
      return response([]);
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByRole("heading", { name: "请先修改平台密码" })).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalledWith("/platform/organizations", expect.anything());
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "Temp123!" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/platform/auth/change-password",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByRole("heading", { name: "超级管理员登录" })).toBeInTheDocument();
  });

  it("强制改密成功后立即清除表单中已记住的临时密码", async () => {
    const forcedUser = { ...user, mustChangePassword: true };
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: forcedUser,
    }));
    const logout = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/platform/auth/me") return response(forcedUser);
      if (input === "/platform/auth/change-password") return new Response(null, { status: 204 });
      if (input === "/platform/auth/logout") return logout.promise;
      return response([]);
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByRole("heading", { name: "请先修改平台密码" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "Temp123!" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/platform/auth/logout",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(screen.getByLabelText("当前密码")).toHaveValue("");
    expect(screen.getByLabelText("新密码")).toHaveValue("");
    expect(screen.getByLabelText("确认新密码")).toHaveValue("");
    logout.resolve(new Response(null, { status: 204 }));
  });

  it("展示平台审计日志", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/platform/auth/me") return response(user);
      if (input === "/platform/organizations") return response([]);
      if (String(input).startsWith("/platform/audit-logs")) {
        return response([{
          id: "audit-1",
          actorId: "platform-1",
          action: "TENANT_ADMIN_PASSWORD_RESET",
          entityType: "User",
          entityId: "admin-1",
          details: { organizationId: "org-1" },
          createdAt: "2026-09-07T08:00:00.000Z",
        }]);
      }
      return response([]);
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByRole("heading", { name: "机构管理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "审计日志" }));

    expect(await screen.findByText("重置管理员密码")).toBeInTheDocument();
    expect(screen.getByText("admin-1")).toBeInTheDocument();
  });

  it("修改平台密码后清除会话并返回登录页", async () => {
    localStorage.setItem("kebao.platform.auth", JSON.stringify({
      accessToken: "platform-access",
      refreshToken: "platform-refresh",
      accessTokenExpiresIn: 900,
      account: user,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/platform/auth/me") return response(user);
      if (input === "/platform/auth/change-password" || input === "/platform/auth/logout") {
        return new Response(null, { status: 204 });
      }
      if (input === "/platform/organizations") return response([]);
      return response([]);
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PlatformApp />);
    expect(await screen.findByRole("heading", { name: "机构管理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "Temp123!" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/platform/auth/change-password",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByRole("heading", { name: "超级管理员登录" })).toBeInTheDocument();
    expect(localStorage.getItem("kebao.platform.auth")).toBeNull();
  });
});
