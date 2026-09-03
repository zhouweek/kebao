import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelAdminBooking,
  cancelSession,
  clearAuth,
  createAdminBooking,
  createSession,
  createSeries,
  getAdminBookings,
  getAuditLogs,
  getNotifications,
  getNotificationDeliveries,
  getRoster,
  getSessions,
  loginAdmin,
  markNotificationRead,
  previewSeries,
  rescheduleSession,
  resendNotificationDelivery,
  updateAttendance,
} from "../src/api";

describe("sessions API client", () => {
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
          organizationId: "org-development",
          role: "ADMIN",
          name: "管理员",
          phone: "13800000001",
        },
      }),
    );
  });

  it("读取通知投递记录并提交补发", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({
        data: String(input).endsWith("/resend")
          ? { accepted: true }
          : [{ id: "delivery-1", status: "FAILED", lastError: "发送失败" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      getNotificationDeliveries(fetcher as typeof fetch),
    ).resolves.toEqual([
      expect.objectContaining({ id: "delivery-1", lastError: "发送失败" }),
    ]);
    await expect(
      resendNotificationDelivery("delivery/1", fetcher as typeof fetch),
    ).resolves.toEqual({ accepted: true });
    expect(fetcher).toHaveBeenLastCalledWith(
      "/admin/notification-deliveries/delivery%2F1/resend",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("读取 GET /sessions 的 data", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "session-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getSessions(fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith("/sessions", {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer access-token",
      },
    });
    expect(result).toEqual([{ id: "session-1" }]);
  });

  it("构造管理员预约筛选并调用代预约、代取消接口", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({
        data: String(input).startsWith("/admin/bookings?")
          ? { items: [], page: 2, pageSize: 10, total: 11 }
          : String(input) === "/admin/bookings"
            ? { booking: { id: "booking-2" }, alreadyBooked: false }
            : { id: "booking-1", status: "CANCELLED" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getAdminBookings({
      page: 2,
      pageSize: 10,
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    }, fetcher as typeof fetch);
    await createAdminBooking("session-1", "student-1", fetcher as typeof fetch);
    await cancelAdminBooking("booking-1", "家长来电", fetcher as typeof fetch);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/admin/bookings?page=2&pageSize=10&sessionId=session-1&studentId=student-1&status=CONFIRMED&from=2026-09-01T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/admin/bookings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", studentId: "student-1" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/admin/bookings/booking-1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "家长来电" }),
      }),
    );
  });

  it("保留 POST /sessions 的冲突详情", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "SESSION_CONFLICT",
            message: "老师或教室在该时段已被占用",
            details: {
              conflicts: [
                {
                  sessionId: "session-1",
                  teacherConflict: true,
                  classroomConflict: false,
                },
              ],
            },
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createSession(
        {
          courseId: "course-art",
          courseName: "创意美术",
          campusId: "campus-a",
          campusName: "A 校区",
          teacherId: "teacher-1",
          teacherName: "王老师",
          startsAt: "2026-09-02T02:00:00.000Z",
          endsAt: "2026-09-02T03:00:00.000Z",
          capacity: 12,
        },
        fetcher as typeof fetch,
      ),
    ).rejects.toMatchObject({
      code: "SESSION_CONFLICT",
      status: 409,
      details: {
        conflicts: [
          {
            sessionId: "session-1",
            teacherConflict: true,
            classroomConflict: false,
          },
        ],
      },
    });
  });

  it("调用系列预检和创建接口", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { series: null, sessions: [], successDates: [], conflicts: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const input = {
      courseId: "course-art",
      courseName: "创意美术",
      campusId: "campus-a",
      campusName: "A 校区",
      teacherId: "teacher-1",
      teacherName: "王老师",
      startsAt: "2026-09-02T02:00:00.000Z",
      endsAt: "2026-09-02T03:00:00.000Z",
      capacity: 12,
      recurrence: "WEEKLY" as const,
      intervalWeeks: 1,
      repeatCount: 8,
      skipConflicts: true,
    };

    await previewSeries(input, fetcher as typeof fetch);
    await createSeries(input, fetcher as typeof fetch);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/session-series/preflight",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/session-series",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
  });

  it("使用 Bearer 访问令牌调用课次运营接口", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getRoster("session-1", fetcher as typeof fetch);
    await updateAttendance(
      "session-1",
      [{ bookingId: "booking-1", status: "ATTENDED" }],
      fetcher as typeof fetch,
    );
    await rescheduleSession(
      "session-1",
      { startsAt: "2026-09-03T02:00:00.000Z", endsAt: "2026-09-03T03:00:00.000Z" },
      fetcher as typeof fetch,
    );
    await cancelSession("session-1", "老师请假", fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith(
      "/teacher/sessions/session-1/roster",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/sessions/session-1/attendance",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          records: [{ bookingId: "booking-1", status: "ATTENDED" }],
        }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/sessions/session-1/reschedule",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/sessions/session-1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "老师请假" }),
      }),
    );
  });

  it("读取通知、标记已读并获取审计日志", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getNotifications(true, fetcher as typeof fetch);
    await markNotificationRead("notice-1", fetcher as typeof fetch);
    await getAuditLogs(fetcher as typeof fetch);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/notifications?unreadOnly=true",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/notifications/notice-1/read",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/audit-logs",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });

  it("默认不发送开发身份头，登录成功后持久化令牌", async () => {
    clearAuth();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          input === "/auth/admin/login"
            ? {
                data: {
                  accessToken: "new-access",
                  refreshToken: "new-refresh",
                  accessTokenExpiresIn: 900,
                  user: {
                    id: "admin-1",
                    organizationId: "org-development",
                    role: "ADMIN",
                    name: "管理员",
                    phone: "13800000001",
                  },
                },
              }
            : { data: [] },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await getSessions(fetcher as typeof fetch);
    expect(fetcher).toHaveBeenNthCalledWith(1, "/sessions", {
      headers: { Accept: "application/json" },
    });

    await loginAdmin("DEMO", "13800000001", "Admin123!", fetcher as typeof fetch);
    await getSessions(fetcher as typeof fetch);
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/sessions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer new-access" }),
      }),
    );
  });
});
