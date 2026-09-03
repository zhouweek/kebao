import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAuth,
  exportStatisticsCsv,
  getStatistics,
} from "../src/api";

beforeEach(() => {
  clearAuth();
  localStorage.setItem(
    "kebao.admin.auth",
    JSON.stringify({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresIn: 900,
      user: {
        id: "admin-1",
        organizationId: "org-a",
        role: "ADMIN",
        name: "管理员",
        phone: "13800000001",
      },
    }),
  );
});

describe("statistics API client", () => {
  it("编码全部筛选条件并读取统计结果", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            metrics: {
              sessionCount: 1,
              reservationCount: 2,
              occupancyRate: 20,
              cancellationRate: 0,
              attendanceRate: 50,
            },
            details: [],
            generatedAt: "2026-09-03T12:00:00.000Z",
            definitions: {},
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getStatistics(
      {
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
        campusId: "campus/a",
        courseId: "course-a",
        teacherId: "teacher-a",
      },
      fetcher as typeof fetch,
    );

    expect(result.metrics.sessionCount).toBe(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/statistics?from=2026-09-01T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z&campusId=campus%2Fa&courseId=course-a&teacherId=teacher-a",
      {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer access-token",
        },
      },
    );
  });

  it("下载 CSV blob 并读取服务端文件名", async () => {
    const fetcher = vi.fn(async () =>
      new Response("\uFEFF统计明细", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="statistics-1.csv"',
        },
      }),
    );

    const result = await exportStatisticsCsv(
      { courseId: "course-a" },
      fetcher as typeof fetch,
    );

    expect(result.filename).toBe("statistics-1.csv");
    expect([...new Uint8Array(await result.blob.arrayBuffer()).slice(0, 3)]).toEqual([
      0xef,
      0xbb,
      0xbf,
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/statistics/export?courseId=course-a",
      {
        headers: {
          Accept: "text/csv",
          Authorization: "Bearer access-token",
        },
      },
    );
  });

  it("导出错误响应保留服务端错误码和文案", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "当前身份无权执行此操作" },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      exportStatisticsCsv({}, fetcher as typeof fetch),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前身份无权执行此操作",
      status: 403,
    });
  });
});
