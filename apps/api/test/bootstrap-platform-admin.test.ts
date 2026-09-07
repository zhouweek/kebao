import { describe, expect, it, vi } from "vitest";
import { bootstrapPlatformAdmin } from "../src/bootstrap-platform-admin.js";
import { verifyPassword } from "../src/auth.js";

describe("bootstrapPlatformAdmin", () => {
  it("[defect-probing] 显式配置全空白初始密码时启动失败", async () => {
    const prisma = {
      platformAccount: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    };

    await expect(
      bootstrapPlatformAdmin(prisma as never, {
        PLATFORM_ADMIN_PASSWORD: "   ",
      }),
    ).rejects.toThrow(/PLATFORM_ADMIN_PASSWORD/);
    expect(prisma.platformAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.platformAccount.upsert).not.toHaveBeenCalled();
  });

  it("账号已存在时不执行 upsert，因而不会覆盖密码", async () => {
    const upsert = vi.fn();
    const prisma = {
      platformAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: "existing-account" }),
        upsert,
      },
    };

    await expect(
      bootstrapPlatformAdmin(prisma as never, {
        PLATFORM_ADMIN_USERNAME: "root",
        PLATFORM_ADMIN_PASSWORD: "Replacement123!",
      }),
    ).resolves.toBe("skipped");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("仅在账号缺失时创建强制改密的平台账号", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "new-account" });
    const prisma = {
      platformAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert,
      },
    };

    await expect(
      bootstrapPlatformAdmin(prisma as never, {
        PLATFORM_ADMIN_USERNAME: "root",
        PLATFORM_ADMIN_PASSWORD: "Initial123!",
      }),
    ).resolves.toBe("created");

    const input = upsert.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      where: { username: "root" },
      update: {},
      create: {
        username: "root",
        name: "超级管理员",
        mustChangePassword: true,
      },
    });
    expect(await verifyPassword("Initial123!", input.create.passwordHash)).toBe(true);
  });
});
