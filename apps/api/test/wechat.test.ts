import { describe, expect, it, vi } from "vitest";
import { WechatApi } from "../src/wechat.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WechatApi", () => {
  it("调用 code2session 与 getuserphonenumber，并缓存 access_token", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/sns/jscode2session")) {
        return jsonResponse({ openid: `openid-${new URL(url).searchParams.get("js_code")}` });
      }
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "wechat-token", expires_in: 7200 });
      }
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        code: expect.any(String),
      });
      return jsonResponse({
        errcode: 0,
        phone_info: { purePhoneNumber: "13800000002" },
      });
    });
    const api = new WechatApi({
      appId: "app-id",
      appSecret: "app-secret",
      fetcher: fetcher as typeof fetch,
      now: () => 1_000,
    });

    await expect(api.resolveIdentity("login-a", "phone-a")).resolves.toEqual({
      openId: "openid-login-a",
      phone: "13800000002",
    });
    await expect(api.resolveOpenId("login-demo")).resolves.toBe(
      "openid-login-demo",
    );
    await api.resolveIdentity("login-b", "phone-b");

    expect(
      fetcher.mock.calls.filter(([url]) => String(url).includes("/cgi-bin/token")),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).includes("/wxa/business/getuserphonenumber"),
      ),
    ).toHaveLength(2);
  });
});
