import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { MemoryRepository } from "../src/memory-repository.js";

const apps: ReturnType<typeof buildApp>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("生产 HTTP 边界", () => {
  it("返回安全头、请求 ID，并只允许配置的 CORS 来源", async () => {
    const app = buildApp(new MemoryRepository(), {
      corsOrigins: ["https://admin.example.com"],
    });
    apps.push(app);

    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "https://admin.example.com",
        "x-request-id": "proxy-request-1",
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["x-request-id"]).toBe("proxy-request-1");
    expect(allowed.headers["x-content-type-options"]).toBe("nosniff");
    expect(allowed.headers["x-frame-options"]).toBe("DENY");
    expect(allowed.headers["strict-transport-security"]).toContain("max-age=");
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://admin.example.com",
    );

    const denied = await app.inject({
      method: "OPTIONS",
      url: "/sessions",
      headers: { origin: "https://evil.example.com" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("CORS_ORIGIN_DENIED");
  });

  it("执行限流，并在错误响应中返回请求 ID", async () => {
    const app = buildApp(new MemoryRepository(), {
      rateLimit: { maximum: 1, windowMs: 60_000 },
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    const limited = await app.inject({ method: "GET", url: "/health" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
      requestId: expect.any(String),
    });
  });

  it("就绪检查失败返回 503，指标端点校验 Bearer 并输出 Prometheus 文本", async () => {
    const app = buildApp(new MemoryRepository(), {
      readinessCheck: async () => {
        throw new Error("database unavailable");
      },
      metricsToken: "metrics-token",
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    const metrics = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer metrics-token" },
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("kebao_http_requests_total");
  });

  it("以安全 CSP 提供 /platform 和 /platform/ 静态入口", async () => {
    const root = await mkdtemp(join(tmpdir(), "kebao-admin-web-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "index.html"), "<!doctype html><title>platform</title>");
    const app = buildApp(new MemoryRepository(), { adminWebRoot: root });
    apps.push(app);

    for (const url of ["/platform", "/platform/"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("<title>platform</title>");
      expect(response.headers["cache-control"]).toBe("no-cache");
      expect(response.headers["content-security-policy"]).toContain(
        "default-src 'self'",
      );
      expect(response.headers["content-security-policy"]).not.toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
    }
  });
});

describe("老师名单隐私", () => {
  it("老师读取名单时只返回脱敏家长手机号", async () => {
    const repository = new MemoryRepository({
      organizations: ["org-a"],
      users: [{ id: "teacher-a", organizationId: "org-a", role: "TEACHER" }],
      students: [
        {
          id: "student-a",
          organizationId: "org-a",
          name: "学生甲",
          guardianPhone: "13812345678",
        },
      ],
      sessions: [
        {
          id: "session-a",
          organizationId: "org-a",
          courseId: "course-a",
          courseName: "编程",
          campusId: "campus-a",
          campusName: "中心校区",
          classroomId: null,
          classroomName: null,
          teacherId: "teacher-a",
          teacherName: "王老师",
          startsAt: new Date("2026-09-10T02:00:00.000Z"),
          endsAt: new Date("2026-09-10T03:00:00.000Z"),
          capacity: 10,
          status: "PUBLISHED",
          bookingOpensAt: new Date("2026-09-01T00:00:00.000Z"),
          bookingClosesAt: new Date("2026-09-10T00:00:00.000Z"),
          cancelDeadlineAt: new Date("2026-09-09T22:00:00.000Z"),
        },
      ],
      bookings: [
        {
          id: "booking-a",
          organizationId: "org-a",
          sessionId: "session-a",
          studentId: "student-a",
          status: "CONFIRMED",
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      ],
    });
    const app = buildApp(repository, { developmentIdentityEnabled: true });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/teacher/sessions/session-a/roster",
      headers: {
        "x-tenant-id": "org-a",
        "x-role": "TEACHER",
        "x-user-id": "teacher-a",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].guardianPhone).toBe("138****5678");
    expect(response.body).not.toContain("13812345678");
  });
});
