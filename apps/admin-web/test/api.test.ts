import { describe, expect, it, vi } from "vitest";
import {
  cancelSession,
  createSession,
  getAuditLogs,
  getNotifications,
  getRoster,
  getSessions,
  markNotificationRead,
  rescheduleSession,
  updateAttendance,
} from "../src/api";

describe("sessions API client", () => {
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
        "x-role": "ADMIN",
        "x-tenant-id": "org-development",
        "x-user-id": "admin-1",
      },
    });
    expect(result).toEqual([{ id: "session-1" }]);
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

  it("使用开发身份头调用课次运营接口", async () => {
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
        headers: expect.objectContaining({ "x-user-id": "admin-1" }),
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
      expect.objectContaining({ headers: expect.objectContaining({ "x-role": "ADMIN" }) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/notifications/notice-1/read",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/audit-logs",
      expect.objectContaining({ headers: expect.objectContaining({ "x-tenant-id": "org-development" }) }),
    );
  });
});
