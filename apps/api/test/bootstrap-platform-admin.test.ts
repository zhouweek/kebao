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

  it("密码版本缺失或不是正整数时启动失败", async () => {
    const prisma = {
      platformAccount: { findUnique: vi.fn(), upsert: vi.fn() },
      $transaction: vi.fn(),
    };

    for (const version of [undefined, "", "0", "-1", "1.5", "abc"]) {
      await expect(
        bootstrapPlatformAdmin(prisma as never, {
          PLATFORM_ADMIN_PASSWORD: "Initial123!",
          ...(version === undefined
            ? {}
            : { PLATFORM_ADMIN_PASSWORD_VERSION: version }),
        }),
      ).rejects.toThrow(/PLATFORM_ADMIN_PASSWORD_VERSION/);
    }
    expect(prisma.platformAccount.findUnique).not.toHaveBeenCalled();
  });

  it("账号已存在且环境版本不大于持久化版本时不覆盖密码", async () => {
    const upsert = vi.fn();
    const prisma = {
      platformAccount: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "existing-account", passwordVersion: 2 }),
        upsert,
      },
      $transaction: vi.fn(),
    };

    for (const version of ["1", "2"]) {
      await expect(
        bootstrapPlatformAdmin(prisma as never, {
          PLATFORM_ADMIN_USERNAME: "root",
          PLATFORM_ADMIN_PASSWORD: "Replacement123!",
          PLATFORM_ADMIN_PASSWORD_VERSION: version,
        }),
      ).resolves.toBe("skipped");
    }
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("环境版本更大时原子更新密码、强制改密并撤销全部平台会话", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const revokeSessions = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = {
      platformAccount: { updateMany },
      platformSession: { updateMany: revokeSessions },
    };
    const prisma = {
      platformAccount: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "existing-account", passwordVersion: 2 }),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (operation) => operation(transaction)),
    };

    await expect(
      bootstrapPlatformAdmin(prisma as never, {
        PLATFORM_ADMIN_USERNAME: "root",
        PLATFORM_ADMIN_PASSWORD: "Recovered123!",
        PLATFORM_ADMIN_PASSWORD_VERSION: "3",
      }),
    ).resolves.toBe("updated");

    const update = updateMany.mock.calls[0]?.[0];
    expect(update).toMatchObject({
      where: {
        id: "existing-account",
        passwordVersion: { lt: 3 },
      },
      data: {
        passwordVersion: 3,
        mustChangePassword: true,
      },
    });
    expect(await verifyPassword("Recovered123!", update.data.passwordHash)).toBe(
      true,
    );
    expect(revokeSessions).toHaveBeenCalledWith({
      where: { accountId: "existing-account", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("仅在账号缺失时创建强制改密的平台账号", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "new-account" });
    const prisma = {
      platformAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert,
      },
      $transaction: vi.fn(),
    };

    await expect(
      bootstrapPlatformAdmin(prisma as never, {
        PLATFORM_ADMIN_USERNAME: "root",
        PLATFORM_ADMIN_PASSWORD: "Initial123!",
        PLATFORM_ADMIN_PASSWORD_VERSION: "1",
      }),
    ).resolves.toBe("created");

    const input = upsert.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      where: { username: "root" },
      update: {},
      create: {
        username: "root",
        name: "超级管理员",
        passwordVersion: 1,
        mustChangePassword: true,
      },
    });
    expect(await verifyPassword("Initial123!", input.create.passwordHash)).toBe(true);
  });
});
