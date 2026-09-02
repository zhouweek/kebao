import { describe, expect, it } from "vitest";
import type { CourseSession } from "../src/api/types";
import {
  canCancelBooking,
  formatSessionTime,
  getBookingAvailability,
  getSessionStatusLabel,
} from "../src/utils/session";

const baseSession: CourseSession = {
  id: "session-1",
  courseId: "course-1",
  courseName: "少儿编程",
  campusId: "campus-a",
  campusName: "A 校区",
  classroomId: "room-1",
  classroomName: "101 教室",
  teacherId: "teacher-1",
  teacherName: "王老师",
  startsAt: "2026-09-02T02:00:00.000Z",
  endsAt: "2026-09-02T03:30:00.000Z",
  capacity: 10,
  status: "PUBLISHED",
  bookingOpensAt: "2026-08-26T02:00:00.000Z",
  bookingClosesAt: "2026-09-02T00:00:00.000Z",
  cancelDeadlineAt: "2026-09-01T22:00:00.000Z",
  bookedCount: 6,
  remainingCapacity: 4,
};

describe("课程展示规则", () => {
  it("格式化课程日期与起止时间", () => {
    expect(
      formatSessionTime(
        "2026-09-02T10:05:00+08:00",
        "2026-09-02T11:35:00+08:00",
      ),
    ).toBe("9月2日 10:05–11:35");
  });

  it("返回所有课次状态的中文文案", () => {
    expect(getSessionStatusLabel("DRAFT")).toBe("草稿");
    expect(getSessionStatusLabel("PUBLISHED")).toBe("可预约");
    expect(getSessionStatusLabel("CLOSED")).toBe("已停招");
    expect(getSessionStatusLabel("CANCELLED")).toBe("已停课");
    expect(getSessionStatusLabel("FINISHED")).toBe("已结束");
  });
});

describe("getBookingAvailability", () => {
  it("在开放窗口且有余位时允许预约", () => {
    expect(
      getBookingAvailability(baseSession, new Date("2026-09-01T00:00:00.000Z")),
    ).toEqual({ enabled: true, label: "余 4 位" });
  });

  it("满员时禁用预约", () => {
    expect(
      getBookingAvailability(
        { ...baseSession, remainingCapacity: 0 },
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toEqual({ enabled: false, label: "已满" });
  });

  it("预约尚未开放时给出明确原因", () => {
    expect(
      getBookingAvailability(baseSession, new Date("2026-08-25T00:00:00.000Z")),
    ).toEqual({ enabled: false, label: "预约未开放" });
  });

  it("预约截止时刻起禁用预约", () => {
    expect(
      getBookingAvailability(baseSession, new Date(baseSession.bookingClosesAt)),
    ).toEqual({ enabled: false, label: "预约已截止" });
  });

  it("非发布状态优先展示课次状态", () => {
    expect(
      getBookingAvailability(
        { ...baseSession, status: "CANCELLED", remainingCapacity: 0 },
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toEqual({ enabled: false, label: "已停课" });
  });
});

describe("canCancelBooking", () => {
  it("截止前允许取消，截止时刻起不允许取消", () => {
    expect(
      canCancelBooking(
        baseSession.cancelDeadlineAt,
        new Date("2026-09-01T21:59:59.999Z"),
      ),
    ).toBe(true);
    expect(
      canCancelBooking(
        baseSession.cancelDeadlineAt,
        new Date(baseSession.cancelDeadlineAt),
      ),
    ).toBe(false);
  });
});
