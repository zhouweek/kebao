import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./auth.js";

type PlatformAccountBootstrapClient = Pick<
  PrismaClient,
  "platformAccount" | "$transaction"
>;

export async function bootstrapPlatformAdmin(
  prisma: PlatformAccountBootstrapClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<"created" | "updated" | "skipped"> {
  const configuredPassword = env.PLATFORM_ADMIN_PASSWORD;
  if (configuredPassword === undefined) return "skipped";
  const password = configuredPassword.trim();
  if (password.length < 8 || password.length > 128) {
    throw new Error("PLATFORM_ADMIN_PASSWORD 必须为 8 到 128 个字符");
  }
  const configuredVersion = env.PLATFORM_ADMIN_PASSWORD_VERSION?.trim() || "1";
  if (!/^[1-9]\d*$/.test(configuredVersion)) {
    throw new Error("PLATFORM_ADMIN_PASSWORD_VERSION 必须为正整数");
  }
  const passwordVersion = Number(configuredVersion);
  if (!Number.isSafeInteger(passwordVersion)) {
    throw new Error("PLATFORM_ADMIN_PASSWORD_VERSION 必须为安全范围内的正整数");
  }

  const username = env.PLATFORM_ADMIN_USERNAME?.trim() || "superadmin";
  if (username.length > 64) {
    throw new Error("PLATFORM_ADMIN_USERNAME 最多 64 个字符");
  }

  const existing = await prisma.platformAccount.findUnique({
    where: { username },
    select: { id: true, passwordVersion: true },
  });
  if (existing) {
    if (passwordVersion <= existing.passwordVersion) {
      console.info(`平台账号 ${username} 密码版本未提升，跳过更新`);
      return "skipped";
    }

    const passwordHash = await hashPassword(password);
    const updated = await prisma.$transaction(async (transaction) => {
      const result = await transaction.platformAccount.updateMany({
        where: {
          id: existing.id,
          passwordVersion: { lt: passwordVersion },
        },
        data: {
          passwordHash,
          passwordVersion,
          mustChangePassword: true,
        },
      });
      if (result.count === 0) return false;
      await transaction.platformSession.updateMany({
        where: { accountId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    });
    if (!updated) {
      console.info(`平台账号 ${username} 密码版本已被并发更新，跳过更新`);
      return "skipped";
    }
    console.info(`平台账号 ${username} 密码已按版本 ${passwordVersion} 更新`);
    return "updated";
  }

  await prisma.platformAccount.upsert({
    where: { username },
    update: {},
    create: {
      username,
      name: "超级管理员",
      passwordHash: await hashPassword(password),
      passwordVersion,
      mustChangePassword: true,
    },
  });
  console.info(`平台账号 ${username} 已创建`);
  return "created";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await bootstrapPlatformAdmin(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
