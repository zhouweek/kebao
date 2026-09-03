import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app.js";
import { MemoryRepository } from "./memory-repository.js";
import { PrismaRepository } from "./prisma-repository.js";
import { createDevelopmentSeed } from "./seed.js";
import {
  NotificationWorker,
  parseWechatTemplateConfig,
} from "./notification-worker.js";
import { WechatApi } from "./wechat.js";
import { loadRuntimeConfig } from "./production-config.js";

const config = loadRuntimeConfig();
const prisma = config.databaseUrl ? new PrismaClient() : undefined;
const repository = prisma
  ? new PrismaRepository(prisma)
  : new MemoryRepository(createDevelopmentSeed());
const developmentIdentityEnabled = !prisma || config.developmentIdentityEnabled;
if (prisma && config.tokenSecret === "development-only-change-me") {
  throw new Error("连接数据库时必须设置 AUTH_TOKEN_SECRET");
}

const wechatApi =
  process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET
    ? new WechatApi({
        appId: process.env.WECHAT_APP_ID,
        appSecret: process.env.WECHAT_APP_SECRET,
      })
    : undefined;
const notificationWorker = new NotificationWorker(
  repository,
  wechatApi,
  parseWechatTemplateConfig(process.env),
);

const app = buildApp(repository, {
  developmentIdentityEnabled,
  tokenSecret: config.tokenSecret,
  ...(wechatApi
    ? {
        wechatIdentityResolver: (loginCode: string, phoneCode: string) =>
          wechatApi.resolveIdentity(loginCode, phoneCode),
      }
    : {}),
  notificationWorker,
  corsOrigins: config.corsOrigins,
  rateLimit: {
    maximum: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  },
  ...(config.metricsToken ? { metricsToken: config.metricsToken } : {}),
  readinessCheck: prisma
    ? async () => {
        await prisma.$queryRaw`SELECT 1`;
      }
    : async () => undefined,
  logger: true,
  trustProxy: config.trustProxy,
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const configuredWorkerInterval = Number(
  process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? 60_000,
);
const workerIntervalMs = Number.isFinite(configuredWorkerInterval)
  ? Math.max(10_000, configuredWorkerInterval)
  : 60_000;
let workerRunning = false;
const runNotificationWorker = async () => {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await notificationWorker.enqueueReminders();
    await notificationWorker.processBatch();
  } catch (error) {
    app.log.error(error, "通知 worker 执行失败");
  } finally {
    workerRunning = false;
  }
};
const notificationTimer = setInterval(() => void runNotificationWorker(), workerIntervalMs);
notificationTimer.unref();
void runNotificationWorker();

app.addHook("onClose", async () => {
  clearInterval(notificationTimer);
  if (prisma) {
    await prisma.$disconnect();
  }
});

try {
  if (prisma) {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  }
  await app.listen({ port, host });
  app.log.info(
    { host, port, repository: prisma ? "prisma" : "memory" },
    "课宝 API 已启动",
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "收到退出信号");
  await app.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
