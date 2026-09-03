import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../src/api/client", () => ({
  request: requestMock,
}));

import {
  getSubscriptionConfig,
  listNotifications,
  markNotificationRead,
} from "../src/api/notifications";

describe("站内通知 API 封装", () => {
  beforeEach(() => requestMock.mockReset());

  it("支持读取全部和仅未读通知", async () => {
    const notices = [{ id: "notice-1", readAt: null }];
    requestMock.mockResolvedValue({ data: notices });

    await expect(listNotifications()).resolves.toBe(notices);
    expect(requestMock).toHaveBeenLastCalledWith("/notifications");

    await expect(listNotifications(true)).resolves.toBe(notices);
    expect(requestMock).toHaveBeenLastCalledWith(
      "/notifications?unreadOnly=true",
    );
  });

  it("编码通知 ID 并标记已读", async () => {
    const notice = {
      id: "notice/1",
      readAt: "2026-09-02T10:00:00.000Z",
    };
    requestMock.mockResolvedValue({ data: notice });

    await expect(markNotificationRead("notice/1")).resolves.toBe(notice);
    expect(requestMock).toHaveBeenCalledWith(
      "/notifications/notice%2F1/read",
      { method: "PATCH" },
    );
  });

  it("读取微信订阅消息授权模板", async () => {
    requestMock.mockResolvedValue({
      data: { templateIds: ["template-booking", "template-reminder"] },
    });

    await expect(getSubscriptionConfig()).resolves.toEqual([
      "template-booking",
      "template-reminder",
    ]);
    expect(requestMock).toHaveBeenCalledWith(
      "/notifications/subscription-config",
    );
  });
});
