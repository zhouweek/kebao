export interface RuntimeConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl?: string;
  tokenSecret: string;
  developmentIdentityEnabled: boolean;
  corsOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  metricsToken?: string;
  trustProxy: boolean;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  if (
    env.NODE_ENV !== undefined &&
    !["development", "test", "production"].includes(env.NODE_ENV)
  ) {
    throw new Error("NODE_ENV 只能是 development、test 或 production");
  }
  const nodeEnv =
    env.NODE_ENV === "production" || env.NODE_ENV === "test"
      ? env.NODE_ENV
      : "development";
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const tokenSecret = env.AUTH_TOKEN_SECRET ?? "development-only-change-me";
  const developmentIdentityEnabled = env.DEV_IDENTITY_ENABLED === "true";
  const corsOrigins = parseOrigins(env.CORS_ORIGINS);
  const metricsToken = env.METRICS_TOKEN?.trim() || undefined;
  const config: RuntimeConfig = {
    nodeEnv,
    tokenSecret,
    developmentIdentityEnabled,
    corsOrigins,
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 300, "RATE_LIMIT_MAX"),
    rateLimitWindowMs: positiveInteger(
      env.RATE_LIMIT_WINDOW_MS,
      60_000,
      "RATE_LIMIT_WINDOW_MS",
    ),
    trustProxy: env.TRUST_PROXY === "true",
  };
  if (databaseUrl) config.databaseUrl = databaseUrl;
  if (metricsToken) config.metricsToken = metricsToken;

  if (nodeEnv === "production") {
    const errors: string[] = [];
    if (!databaseUrl) errors.push("DATABASE_URL 必填");
    if (
      tokenSecret.length < 32 ||
      tokenSecret === "development-only-change-me" ||
      tokenSecret.includes("replace-with")
    ) {
      errors.push("AUTH_TOKEN_SECRET 必须是至少 32 位的非示例随机值");
    }
    if (developmentIdentityEnabled) {
      errors.push("生产环境禁止启用 DEV_IDENTITY_ENABLED");
    }
    if (corsOrigins.length === 0) {
      errors.push("CORS_ORIGINS 必须明确配置允许的 HTTPS 来源");
    } else if (corsOrigins.some((origin) => !origin.startsWith("https://"))) {
      errors.push("生产环境 CORS_ORIGINS 仅允许 https:// 来源");
    }
    if (!config.trustProxy) {
      errors.push("反向代理部署必须设置 TRUST_PROXY=true");
    }
    if (!metricsToken || metricsToken.length < 16 || metricsToken.includes("replace-with")) {
      errors.push("METRICS_TOKEN 必须是至少 16 位的非示例随机值");
    }
    if (errors.length > 0) {
      throw new Error(`生产配置校验失败：${errors.join("；")}`);
    }
  }
  return config;
}
