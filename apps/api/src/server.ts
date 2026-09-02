import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app.js";
import { MemoryRepository } from "./memory-repository.js";
import { PrismaRepository } from "./prisma-repository.js";
import { createDevelopmentSeed } from "./seed.js";

const prisma = process.env.DATABASE_URL ? new PrismaClient() : undefined;
const repository = prisma
  ? new PrismaRepository(prisma)
  : new MemoryRepository(createDevelopmentSeed());
const developmentIdentityEnabled =
  !prisma || process.env.DEV_IDENTITY_ENABLED === "true";
const app = buildApp(repository, { developmentIdentityEnabled });
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

if (prisma) {
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
}

try {
  await app.listen({ port, host });
  console.log(
    `课宝 API 已启动：http://${host}:${port}（${
      prisma ? "Prisma/PostgreSQL" : "内存仓储"
    }）`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
