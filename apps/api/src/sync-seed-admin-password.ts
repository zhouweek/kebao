import { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "./auth.js";

const password = process.env.SEED_ADMIN_PASSWORD?.trim();

if (!password) {
  process.exit(0);
}

if (password.length < 8 || password.length > 128) {
  throw new Error("SEED_ADMIN_PASSWORD 必须为 8 到 128 个字符");
}

const prisma = new PrismaClient();

try {
  const organization = await prisma.organization.findUnique({
    where: { code: "DEMO" },
    select: { id: true },
  });
  if (!organization) {
    console.info("DEMO 机构尚未初始化，跳过初始管理员密码同步");
    process.exitCode = 0;
  } else {
    const result = await prisma.user.updateMany({
      where: {
        organizationId: organization.id,
        role: "ADMIN",
        phone: "13800000001",
      },
      data: {
        passwordHash: await hashPassword(password),
        isActive: true,
      },
    });
    if (result.count === 0) {
      console.info("初始管理员账号尚未初始化，跳过密码同步");
    } else {
      const admin = await prisma.user.findFirst({
        where: {
          organizationId: organization.id,
          role: "ADMIN",
          phone: "13800000001",
        },
        select: { passwordHash: true },
      });
      if (
        !admin?.passwordHash ||
        !(await verifyPassword(password, admin.passwordHash))
      ) {
        throw new Error("初始管理员密码同步校验失败");
      }
      console.info("初始管理员密码已与 SEED_ADMIN_PASSWORD 同步");
    }
  }
} finally {
  await prisma.$disconnect();
}
