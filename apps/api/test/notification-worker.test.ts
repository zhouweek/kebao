import { describe, expect, it, vi } from "vitest";
import {
  SchedulingService,
  type CourseSession,
  type NotificationDelivery,
} from "../src/domain.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { NotificationWorker, parseWechatTemplateConfig } from "../src/notification-worker.js";

const NOW = new Date("2026-09-01T10:00:00.000Z");

function session(overrides: Partial<CourseSession> = {}): CourseSession {
  return {
    id: "session-1",
    courseId: "course-1",
    courseName: "少儿编程",
    campusId: "campus-1",
    campusName: "中心校区",
    classroomId: "room-1",
    classroomName: "101",
    teacherId: "teacher-1",
    teacherName: "王老师",
    startsAt: new Date("2026-09-02T10:00:00.000Z"),
    endsAt: new Date("2026-09-02T11:00:00.000Z"),
    capacity: 10,
    status: "PUBLISHED",
    bookingOpensAt: new Date("2026-08-25T10:00:00.000Z"),
    bookingClosesAt: new Date("2026-09-02T08:00:00.000Z"),
    cancelDeadlineAt: new Date("2026-09-02T06:00:00.000Z"),
    ...overrides,
  };
}

function repository() {
  return new MemoryRepository({
    users: [
      {
        id: "teacher-1",
        organizationId: "org-development",
        role: "TEACHER",
        name: "王老师",
        wechatOpenId: "openid-teacher",
      },
      {
        id: "guardian-1",
        organizationId: "org-development",
        role: "GUARDIAN",
        name: "家长甲",
        wechatOpenId: "openid-guardian",
      },
    ],
    guardians: [
      {
        organizationId: "org-development",
        guardianId: "guardian-1",
        studentId: "student-1",
      },
    ],
    students: [{ id: "student-1", name: "学生甲", guardianPhone: "13800000000" }],
    sessions: [session()],
  });
}

function delivery(overrides: Partial<NotificationDelivery> = {}): NotificationDelivery {
  return {
    id: "delivery-1",
    notificationId: "notification-1",
    userId: "guardian-1",
    channel: "WECHAT",
    status: "PENDING",
    attemptCount: 0,
    lastError: null,
    idempotencyKey: "event-1:guardian-1",
    payload: {
      type: "BOOKING_CONFIRMED",
      title: "预约成功",
      content: "课程预约成功",
      sessionId: "session-1",
    },
    nextAttemptAt: NOW,
    sentAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("SchedulingService 通知 Outbox", () => {
  it("预约成功同时通知家长和老师，重复预约不重复入队", async () => {
    const repo = repository();
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `generated-${++sequence}`,
    );

    const first = await service.book("session-1", "student-1");
    const second = await service.book("session-1", "student-1");
    const deliveries = await repo.listAdminNotificationDeliveries(
      "org-development",
      20,
    );

    expect(first.alreadyBooked).toBe(false);
    expect(second.alreadyBooked).toBe(true);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((item) => item.userId).sort()).toEqual([
      "guardian-1",
      "teacher-1",
    ]);
    expect(deliveries.every((item) => item.status === "PENDING")).toBe(true);
  });

  it("预约取消通知老师且保持业务成功", async () => {
    const repo = repository();
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => NOW,
      () => `generated-${++sequence}`,
    );
    const { booking } = await service.book("session-1", "student-1");

    await expect(service.cancelBooking(booking.id)).resolves.toMatchObject({
      status: "CANCELLED",
    });
    const deliveries = await repo.listAdminNotificationDeliveries(
      "org-development",
      20,
    );
    expect(
      deliveries.some(
        (item) =>
          item.userId === "teacher-1" &&
          item.notification.type === "BOOKING_CANCELLED",
      ),
    ).toBe(true);
  });

  it("24 小时和 2 小时提醒分别只入队一次", async () => {
    const repo = repository();
    let current = NOW;
    let sequence = 0;
    const service = new SchedulingService(
      repo,
      () => current,
      () => `generated-${++sequence}`,
    );
    await service.book("session-1", "student-1");

    current = new Date("2026-09-01T10:01:00.000Z");
    await expect(service.enqueueDueReminders()).resolves.toBe(2);
    await expect(service.enqueueDueReminders()).resolves.toBe(0);
    current = new Date("2026-09-02T08:00:00.000Z");
    await expect(service.enqueueDueReminders()).resolves.toBe(2);

    const deliveries = await repo.listAdminNotificationDeliveries(
      "org-development",
      20,
    );
    expect(
      deliveries.filter((item) => item.notification.type === "SESSION_REMINDER_24H"),
    ).toHaveLength(2);
    expect(
      deliveries.filter((item) => item.notification.type === "SESSION_REMINDER_2H"),
    ).toHaveLength(2);
  });
});

describe("NotificationWorker", () => {
  function workerRepository(item = delivery()) {
    return new MemoryRepository({
      users: [
        {
          id: "guardian-1",
          organizationId: "org-development",
          role: "GUARDIAN",
          name: "家长甲",
          wechatOpenId: "openid-guardian",
        },
      ],
      notifications: [
        {
          id: "notification-1",
          userId: "guardian-1",
          type: "BOOKING_CONFIRMED",
          title: "预约成功",
          content: "课程预约成功",
          sessionId: "session-1",
          idempotencyKey: "event-1:guardian-1",
          readAt: null,
          createdAt: NOW,
        },
      ],
      notificationDeliveries: [item],
    });
  }

  it("发送成功后记录 SENT、尝试次数和发送时间", async () => {
    const repo = workerRepository();
    const send = vi.fn().mockResolvedValue(undefined);
    const worker = new NotificationWorker(
      repo,
      { configured: true, send },
      { templateIds: { BOOKING_CONFIRMED: "template-1" } },
      () => NOW,
    );

    await expect(worker.processBatch()).resolves.toBe(1);
    expect(send).toHaveBeenCalledWith(
      "openid-guardian",
      "template-1",
      expect.objectContaining({ type: "BOOKING_CONFIRMED" }),
      expect.any(Object),
    );
    await expect(
      repo.listAdminNotificationDeliveries("org-development", 10),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "SENT",
        attemptCount: 1,
        sentAt: NOW,
        lastError: null,
      }),
    ]);
  });

  it("外部发送失败时记录原因并按指数退避，不抛出到业务层", async () => {
    const repo = workerRepository();
    const worker = new NotificationWorker(
      repo,
      {
        configured: true,
        send: vi.fn().mockRejectedValue(new Error("微信服务暂时不可用")),
      },
      { templateIds: { BOOKING_CONFIRMED: "template-1" } },
      () => NOW,
    );

    await expect(worker.processBatch()).resolves.toBe(1);
    await expect(
      repo.listAdminNotificationDeliveries("org-development", 10),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "FAILED",
        attemptCount: 1,
        lastError: "微信服务暂时不可用",
        nextAttemptAt: new Date("2026-09-01T10:02:00.000Z"),
      }),
    ]);
  });

  it("无配置时标记跳过，后台补发后恢复为待发送", async () => {
    const repo = workerRepository();
    const worker = new NotificationWorker(repo, undefined, { templateIds: {} }, () => NOW);

    await worker.processBatch();
    const [skipped] = await repo.listAdminNotificationDeliveries(
      "org-development",
      10,
    );
    expect(skipped).toMatchObject({
      status: "SKIPPED",
      lastError: "微信订阅消息未配置",
    });

    await worker.resend("org-development", skipped!.id);
    const [pending] = await repo.listAdminNotificationDeliveries(
      "org-development",
      10,
    );
    expect(pending).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
      lastError: null,
    });
  });

  it("拒绝补发尚未失败或已经成功的投递", async () => {
    const worker = new NotificationWorker(workerRepository(), undefined, {
      templateIds: {},
    });

    await expect(
      worker.resend("org-development", "delivery-1"),
    ).rejects.toMatchObject({
      code: "DELIVERY_NOT_RESENDABLE",
      statusCode: 409,
    });
  });

  it("解析所有通知模板并去重返回授权模板", () => {
    const config = parseWechatTemplateConfig({
      WECHAT_TEMPLATE_BOOKING_CONFIRMED: "template-shared",
      WECHAT_TEMPLATE_BOOKING_CANCELLED: "template-shared",
      WECHAT_TEMPLATE_SESSION_REMINDER_2H: "template-reminder",
    });
    const worker = new NotificationWorker(workerRepository(), undefined, config);

    expect(worker.subscriptionTemplateIds()).toEqual([
      "template-shared",
      "template-reminder",
    ]);
  });
});
