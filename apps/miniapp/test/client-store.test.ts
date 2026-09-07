import { beforeEach, describe, expect, it, vi } from "vitest";

const taroMocks = vi.hoisted(() => ({
  login: vi.fn(),
  request: vi.fn(),
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
  removeStorageSync: vi.fn(),
}));

vi.mock("@tarojs/taro", () => ({
  default: taroMocks,
}));

import { ApiError, getErrorMessage, request } from "../src/api/client";
import { loginWithWechatDemo } from "../src/api/auth";
import {
  getSavedBookings,
  getAuth,
  markBookingCancelled,
  saveAuth,
  saveBooking,
  saveIdentity,
  type SavedBooking,
} from "../src/store/session";

const savedBooking: SavedBooking = {
  booking: {
    id: "booking-1",
    sessionId: "session-1",
    studentId: "student-1",
    status: "CONFIRMED",
    createdAt: "2026-09-01T00:00:00.000Z",
  },
  courseName: "少儿编程",
  startsAt: "2026-09-02T02:00:00.000Z",
  endsAt: "2026-09-02T03:30:00.000Z",
  cancelDeadlineAt: "2026-09-01T22:00:00.000Z",
  campusName: "A 校区",
  classroomName: "101 教室",
};

describe("request", () => {
  beforeEach(() => {
    taroMocks.login.mockReset();
    taroMocks.request.mockReset();
    taroMocks.getStorageSync.mockReset();
    taroMocks.setStorageSync.mockReset();
  });

  it("默认不发送 JSON content-type 和开发身份头", async () => {
    taroMocks.request.mockResolvedValue({
      statusCode: 200,
      data: { data: ["ok"] },
    });

    await expect(
      request("/sessions", {
        method: "GET",
        header: { "x-request-id": "req-1" },
      }),
    ).resolves.toEqual({ data: ["ok"] });
    expect(taroMocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:3000/sessions",
        method: "GET",
        header: { "x-request-id": "req-1" },
      }),
    );
  });

  it("存在访问令牌时发送 Bearer 请求头", async () => {
    taroMocks.getStorageSync.mockImplementation((key: string) =>
      key === "kebao.auth"
        ? {
            accessToken: "access-token",
            refreshToken: "refresh-token",
            accessTokenExpiresIn: 900,
          }
        : undefined,
    );
    taroMocks.request.mockResolvedValue({ statusCode: 200, data: { data: [] } });

    await request("/sessions");

    expect(taroMocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        header: { Authorization: "Bearer access-token" },
      }),
    );
  });

  it("有请求体时发送 JSON content-type", async () => {
    taroMocks.request.mockResolvedValue({
      statusCode: 200,
      data: { data: { id: "booking-1" } },
    });

    await request("/sessions/session-1/bookings", {
      method: "POST",
      data: { studentId: "student-1" },
    });

    expect(taroMocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        header: expect.objectContaining({
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("将后端错误体转换为 ApiError", async () => {
    taroMocks.request.mockResolvedValue({
      statusCode: 409,
      data: {
        error: {
          code: "SESSION_FULL",
          message: "课次名额已满",
          details: { remaining: 0 },
        },
      },
    });

    const promise = request("/sessions/session-1/bookings");
    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      code: "SESSION_FULL",
      message: "课次名额已满",
      statusCode: 409,
      details: { remaining: 0 },
    });
  });

  it("个人主体演示登录提交预建手机号并保存微信身份", async () => {
    taroMocks.login.mockResolvedValue({ code: "wx-login-code" });
    taroMocks.request.mockResolvedValue({
      statusCode: 200,
      data: {
        data: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          accessTokenExpiresIn: 900,
          user: {
            id: "teacher-1",
            organizationId: "org-development",
            role: "TEACHER",
            name: "王老师",
            phone: "18603328161",
          },
        },
      },
    });

    await expect(
      loginWithWechatDemo("DEMO", "18603328161"),
    ).resolves.toMatchObject({ id: "teacher-1", role: "TEACHER" });
    expect(taroMocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:3000/auth/wechat/demo-login",
        method: "POST",
        data: {
          organizationCode: "DEMO",
          loginCode: "wx-login-code",
          phone: "18603328161",
        },
      }),
    );
    expect(taroMocks.setStorageSync).toHaveBeenCalledWith(
      "kebao.identity",
      { id: "teacher-1", name: "王老师", role: "teacher" },
    );
  });

  it("为未知错误提供中文兜底文案", () => {
    expect(getErrorMessage(new ApiError("FAILED", "预约失败", 409))).toBe(
      "预约失败",
    );
    expect(getErrorMessage(null)).toBe("网络开小差了，请稍后重试");
  });
});

describe("本地身份与预约状态", () => {
  beforeEach(() => {
    taroMocks.getStorageSync.mockReset();
    taroMocks.setStorageSync.mockReset();
  });

  it("保存所选身份", () => {
    const identity = { role: "parent" as const, id: "student-1", name: "家长" };
    saveIdentity(identity);
    expect(taroMocks.setStorageSync).toHaveBeenCalledWith(
      "kebao.identity",
      identity,
    );
  });

  it("保存并读取登录令牌", () => {
    const auth = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresIn: 900,
    };
    saveAuth(auth);
    expect(taroMocks.setStorageSync).toHaveBeenCalledWith("kebao.auth", auth);

    taroMocks.getStorageSync.mockReturnValue(auth);
    expect(getAuth()).toEqual(auth);
  });

  it("保存预约时替换同 ID 旧记录并置顶", () => {
    taroMocks.getStorageSync.mockReturnValue([
      { ...savedBooking, courseName: "旧课程" },
      {
        ...savedBooking,
        booking: { ...savedBooking.booking, id: "booking-2" },
      },
    ]);

    saveBooking(savedBooking);
    expect(taroMocks.setStorageSync).toHaveBeenCalledWith(
      "kebao.bookings",
      expect.arrayContaining([
        savedBooking,
        expect.objectContaining({
          booking: expect.objectContaining({ id: "booking-2" }),
        }),
      ]),
    );
    const stored = taroMocks.setStorageSync.mock.calls[0]?.[1] as SavedBooking[];
    expect(stored).toHaveLength(2);
    expect(stored[0]).toBe(savedBooking);
  });

  it("只将目标预约标记为已取消", () => {
    const another = {
      ...savedBooking,
      booking: { ...savedBooking.booking, id: "booking-2" },
    };
    taroMocks.getStorageSync.mockReturnValue([savedBooking, another]);

    markBookingCancelled("booking-1");
    expect(taroMocks.setStorageSync).toHaveBeenCalledWith("kebao.bookings", [
      expect.objectContaining({
        booking: expect.objectContaining({
          id: "booking-1",
          status: "CANCELLED",
        }),
      }),
      another,
    ]);
  });

  it("存储为空时返回空预约列表", () => {
    taroMocks.getStorageSync.mockReturnValue("");
    expect(getSavedBookings()).toEqual([]);
  });
});
