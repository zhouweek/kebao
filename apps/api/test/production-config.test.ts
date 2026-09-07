import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../src/production-config.js";

const validProductionEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://kebao:password@postgres:5432/kebao",
  AUTH_TOKEN_SECRET: "tenant-auth-secret-with-32-characters",
  PLATFORM_AUTH_TOKEN_SECRET: "platform-auth-secret-with-32-characters",
  CORS_ORIGINS: "https://admin.example.com",
  METRICS_TOKEN: "metrics-token-with-16-characters",
  TRUST_PROXY: "true",
};

describe("生产配置", () => {
  it("使用显式且独立的平台令牌密钥", () => {
    const config = loadRuntimeConfig(validProductionEnv);

    expect(config.platformTokenSecret).toBe(
      validProductionEnv.PLATFORM_AUTH_TOKEN_SECRET,
    );
  });

  it("缺少平台令牌密钥或与普通令牌密钥相同时拒绝启动", () => {
    const { PLATFORM_AUTH_TOKEN_SECRET: _omitted, ...withoutPlatformSecret } =
      validProductionEnv;
    expect(() => loadRuntimeConfig(withoutPlatformSecret)).toThrow(
      /PLATFORM_AUTH_TOKEN_SECRET/,
    );
    expect(() =>
      loadRuntimeConfig({
        ...validProductionEnv,
        PLATFORM_AUTH_TOKEN_SECRET: validProductionEnv.AUTH_TOKEN_SECRET,
      }),
    ).toThrow(/PLATFORM_AUTH_TOKEN_SECRET/);
  });

  it("生产 Compose 显式透传平台令牌密钥和可选初始化凭据", async () => {
    const composePath = fileURLToPath(
      new URL("../../../docker-compose.prod.yml", import.meta.url),
    );
    const compose = await readFile(composePath, "utf8");

    expect(compose).toContain(
      "PLATFORM_AUTH_TOKEN_SECRET: ${PLATFORM_AUTH_TOKEN_SECRET:?PLATFORM_AUTH_TOKEN_SECRET is required}",
    );
    expect(compose).toContain(
      "PLATFORM_ADMIN_USERNAME: ${PLATFORM_ADMIN_USERNAME:-superadmin}",
    );
    expect(compose).toContain(
      "PLATFORM_ADMIN_PASSWORD: ${PLATFORM_ADMIN_PASSWORD:-}",
    );
  });
});
