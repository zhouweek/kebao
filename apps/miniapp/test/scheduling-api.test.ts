import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../src/api/client", () => ({
  request: requestMock,
}));

import {
  bookSession,
  cancelBooking,
  cancelSession,
  createSession,
  createSeries,
  getTeacherOptions,
  getRoster,
  listGuardianStudents,
  listSessions,
  markAttendance,
  previewSeries,
  rescheduleSession,
} from "../src/api/scheduling";

describe("排课 API 封装", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("编码筛选条件并解包课次列表", async () => {
    const sessions = [{ id: "session-1" }];
    requestMock.mockResolvedValue({ data: sessions });

    await expect(
      listSessions({
        teacherId: "teacher 1",
        campusId: "A/校区",
        status: "PUBLISHED",
      }),
    ).resolves.toBe(sessions);
    expect(requestMock).toHaveBeenCalledWith(
      "/sessions?teacherId=teacher%201&campusId=A%2F%E6%A0%A1%E5%8C%BA&status=PUBLISHED",
    );
  });

  it("读取老师创建课次所需的启用选项", async () => {
    const options = {
      teacher: { id: "teacher-1", name: "王老师" },
      courses: [],
      campuses: [],
      classrooms: [],
    };
    requestMock.mockResolvedValue({ data: options });

    await expect(getTeacherOptions()).resolves.toBe(options);
    expect(requestMock).toHaveBeenCalledWith("/teacher/options");
  });

  it("读取当前家长绑定的学生", async () => {
    const students = [{ id: "student-1", name: "林小满" }];
    requestMock.mockResolvedValue({ data: students });

    await expect(listGuardianStudents()).resolves.toBe(students);
    expect(requestMock).toHaveBeenCalledWith("/guardian/students");
  });

  it("按契约创建课次", async () => {
    const input = {
      courseId: "course-1",
      courseName: "编程",
      campusId: "campus-1",
      campusName: "北校区",
      teacherId: "teacher-1",
      teacherName: "王老师",
      startsAt: "2026-09-04T02:00:00.000Z",
      endsAt: "2026-09-04T03:00:00.000Z",
      capacity: 12,
    };
    requestMock.mockResolvedValue({ data: { id: "session-1", ...input } });

    await createSession(input);
    expect(requestMock).toHaveBeenCalledWith("/sessions", {
      method: "POST",
      data: input,
    });
  });

  it("预检并创建按周排课系列", async () => {
    const input = {
      courseId: "course-1",
      courseName: "编程",
      campusId: "campus-1",
      campusName: "北校区",
      teacherId: "teacher-1",
      teacherName: "王老师",
      startsAt: "2026-09-04T02:00:00.000Z",
      endsAt: "2026-09-04T03:00:00.000Z",
      capacity: 12,
      recurrence: "WEEKLY" as const,
      intervalWeeks: 1,
      repeatCount: 8,
      skipConflicts: true,
    };
    const result = { sessions: [], successDates: [], conflicts: [] };
    requestMock.mockResolvedValue({ data: result });

    await expect(previewSeries(input)).resolves.toBe(result);
    expect(requestMock).toHaveBeenLastCalledWith("/session-series/preflight", {
      method: "POST",
      data: input,
    });
    await expect(createSeries(input)).resolves.toBe(result);
    expect(requestMock).toHaveBeenLastCalledWith("/session-series", {
      method: "POST",
      data: input,
    });
  });

  it("按后端契约发起预约并返回预约结果", async () => {
    const result = {
      booking: { id: "booking-1" },
      alreadyBooked: false,
    };
    requestMock.mockResolvedValue({ data: result });

    await expect(bookSession("session/1", "student-1")).resolves.toBe(result);
    expect(requestMock).toHaveBeenCalledWith(
      "/sessions/session%2F1/bookings",
      {
        method: "POST",
        data: { studentId: "student-1" },
      },
    );
  });

  it("编码预约 ID 并使用 DELETE 取消", async () => {
    const booking = { id: "booking/1", status: "CANCELLED" };
    requestMock.mockResolvedValue({ data: booking });

    await expect(cancelBooking("booking/1")).resolves.toBe(booking);
    expect(requestMock).toHaveBeenCalledWith("/bookings/booking%2F1", {
      method: "DELETE",
    });
  });

  it("编码课次 ID 并解包老师名单", async () => {
    const roster = [{ id: "student-1", name: "林小满" }];
    requestMock.mockResolvedValue({ data: roster });

    await expect(getRoster("session/1")).resolves.toBe(roster);
    expect(requestMock).toHaveBeenCalledWith(
      "/teacher/sessions/session%2F1/roster",
    );
  });

  it("按契约提交老师调课", async () => {
    const input = {
      startsAt: "2026-09-03T02:00:00.000Z",
      endsAt: "2026-09-03T03:30:00.000Z",
      classroomId: "room-106",
      classroomName: "106 教室",
    };
    const session = { id: "session/1", ...input };
    requestMock.mockResolvedValue({ data: session });

    await expect(rescheduleSession("session/1", input)).resolves.toBe(session);
    expect(requestMock).toHaveBeenCalledWith(
      "/sessions/session%2F1/reschedule",
      { method: "PATCH", data: input },
    );
  });

  it("支持老师停课并传递可选原因", async () => {
    const session = { id: "session-1", status: "CANCELLED" };
    requestMock.mockResolvedValue({ data: session });

    await expect(cancelSession("session-1", "老师请假")).resolves.toBe(session);
    expect(requestMock).toHaveBeenCalledWith("/sessions/session-1/cancel", {
      method: "POST",
      data: { reason: "老师请假" },
    });
  });

  it("批量提交签到状态", async () => {
    const records = [
      { bookingId: "booking-1", status: "ATTENDED" as const },
      { bookingId: "booking-2", status: "LEAVE" as const },
    ];
    const bookings = records.map((record) => ({
      id: record.bookingId,
      status: record.status,
    }));
    requestMock.mockResolvedValue({ data: bookings });

    await expect(markAttendance("session-1", records)).resolves.toBe(bookings);
    expect(requestMock).toHaveBeenCalledWith("/sessions/session-1/attendance", {
      method: "PUT",
      data: { records },
    });
  });
});
