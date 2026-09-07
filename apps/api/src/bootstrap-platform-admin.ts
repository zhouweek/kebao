import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./auth.js";

type PlatformAccountBootstrapClient = Pick<PrismaClient, "platformAccount">;

export async function bootstrapPlatformAdmin(
  prisma: PlatformAccountBootstrapClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<"created" | "skipped"> {
  const configuredPassword = env.PLATFORM_ADMIN_PASSWORD;
  if (configuredPassword === undefined) return "skipped";
  const password = configuredPassword.trim();
  if (password.length < 8 || password.length > 128) {
    throw new Error("PLATFORM_ADMIN_PASSWORD 必须为 8 到 128 个字符");
  }

  const username = env.PLATFORM_ADMIN_USERNAME?.trim() || "superadmin";
  if (username.length > 64) {
    throw new Error("PLATFORM_ADMIN_USERNAME 最多 64 个字符");
  }

  const existing = await prisma.platformAccount.findUnique({
    where: { username },
    select: { id: true },
  });
  if (existing) {
    console.info(`平台账号 ${username} 已存在，跳过初始化且不修改密码`);
    return "skipped";
  }

  await prisma.platformAccount.upsert({
    where: { username },
    update: {},
    create: {
      username,
      name: "超级管理员",
      passwordHash: await hashPassword(password),
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
