import { describe, expect, it } from "vitest";
import { HttpMetrics } from "../src/observability.js";
import { loadRuntimeConfig } from "../src/production-config.js";
import {
  FixedWindowRateLimiter,
  maskPhone,
  safeTokenEqual,
} from "../src/security.js";

describe("loadRuntimeConfig", () => {
  it("加载合法生产配置并解析限流及 CORS 参数", () => {
    const config = loadRuntimeConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:password@postgres:5432/kebao",
      AUTH_TOKEN_SECRET: "a-secure-random-secret-with-32-characters",
      CORS_ORIGINS: "https://admin.example.com, https://ops.example.com",
      RATE_LIMIT_MAX: "120",
      RATE_LIMIT_WINDOW_MS: "30000",
      METRICS_TOKEN: "metrics-secret-long",
      TRUST_PROXY: "true",
    });

    expect(config).toMatchObject({
      nodeEnv: "production",
      developmentIdentityEnabled: false,
      corsOrigins: ["https://admin.example.com", "https://ops.example.com"],
      rateLimitMax: 120,
      rateLimitWindowMs: 30_000,
      metricsToken: "metrics-secret-long",
      trustProxy: true,
    });
  });

  it("拒绝缺少数据库、强密钥、HTTPS CORS 或代理信任的生产配置", () => {
    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: "production",
        AUTH_TOKEN_SECRET: "replace-with-at-least-32-random-characters",
        CORS_ORIGINS: "http://admin.example.com",
      }),
    ).toThrow(/DATABASE_URL.*AUTH_TOKEN_SECRET.*https:\/\/.*TRUST_PROXY/);
  });

  it("[defect-probing] 拒绝未知 NODE_ENV，避免拼写错误绕过生产校验", () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "prodution" })).toThrow(
      /NODE_ENV/,
    );
  });
});

describe("敏感信息与令牌辅助函数", () => {
  it("对大陆手机号和短号码执行稳定脱敏", () => {
    expect(maskPhone("13812345678")).toBe("138****5678");
    expect(maskPhone("123456")).toBe("12**56");
    expect(maskPhone("1234")).toBe("****");
    expect(maskPhone("")).toBe("");
  });

  it("使用常量时间比较语义校验指标令牌", () => {
    expect(safeTokenEqual("same-token", "same-token")).toBe(true);
    expect(safeTokenEqual("wrong-token", "same-token")).toBe(false);
    expect(safeTokenEqual(undefined, "same-token")).toBe(false);
  });
});

describe("FixedWindowRateLimiter", () => {
  it("达到窗口上限后拒绝请求，并在新窗口恢复", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(2, 500, () => now);

    expect(limiter.consume("client")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("client")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("client")).toMatchObject({ allowed: false, remaining: 0 });
    now = 1_500;
    expect(limiter.consume("client")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("不同客户端独立计数", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, () => 1_000);
    expect(limiter.consume("client-a").allowed).toBe(true);
    expect(limiter.consume("client-a").allowed).toBe(false);
    expect(limiter.consume("client-b").allowed).toBe(true);
  });
});

describe("HttpMetrics", () => {
  it("输出 Prometheus 文本并转义标签", () => {
    const metrics = new HttpMetrics();
    metrics.observe("GET", '/route/"quoted"', 200, 250);
    const output = metrics.render();

    expect(output).toContain("kebao_process_uptime_seconds");
    expect(output).toContain(
      'kebao_http_requests_total{method="GET",route="/route/\\"quoted\\"",status="200"} 1',
    );
    expect(output).toContain(
      'kebao_http_request_duration_seconds_sum{method="GET",route="/route/\\"quoted\\"",status="200"} 0.25',
    );
  });
});
