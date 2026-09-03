import {
  DomainError,
  SchedulingService,
  type NotificationDelivery,
  type NotificationType,
  type Repository,
} from "./domain.js";

export interface WechatTemplateConfig {
  templateIds: Partial<Record<NotificationType, string>>;
  miniprogramState?: "developer" | "trial" | "formal";
  language?: string;
}

export interface WechatSubscriptionSender {
  configured: boolean;
  send(
    openId: string,
    templateId: string,
    payload: NotificationDelivery["payload"],
    config: Pick<WechatTemplateConfig, "miniprogramState" | "language">,
  ): Promise<void>;
}

export class NotificationWorker {
  constructor(
    private readonly repository: Repository,
    private readonly sender?: WechatSubscriptionSender,
    private readonly templateConfig: WechatTemplateConfig = { templateIds: {} },
    private readonly now: () => Date = () => new Date(),
    private readonly maxAttempts = 5,
  ) {}

  subscriptionTemplateIds(): string[] {
    return [...new Set(
      Object.values(this.templateConfig.templateIds).filter(
        (templateId): templateId is string => Boolean(templateId),
      ),
    )];
  }

  async enqueueReminders(): Promise<number> {
    let created = 0;
    for (const organizationId of await this.repository.listOrganizationIds()) {
      created += await new SchedulingService(
        this.repository,
        this.now,
        undefined,
        organizationId,
        "notification-worker",
      ).enqueueDueReminders();
    }
    return created;
  }

  async processBatch(limit = 50): Promise<number> {
    const due = await this.repository.listDueNotificationDeliveries(this.now(), limit);
    let processed = 0;
    for (const item of due) {
      const claimed = await this.repository.claimNotificationDelivery(item.id, this.now());
      if (!claimed) continue;
      processed += 1;
      await this.deliver(item.organizationId, claimed);
    }
    return processed;
  }

  async resend(organizationId: string, deliveryId: string): Promise<void> {
    const delivery = await this.repository.getNotificationDelivery(
      organizationId,
      deliveryId,
    );
    if (!delivery) {
      throw new DomainError("DELIVERY_NOT_FOUND", "发送记录不存在", 404);
    }
    if (!["FAILED", "SKIPPED"].includes(delivery.status)) {
      throw new DomainError(
        "DELIVERY_NOT_RESENDABLE",
        "仅发送失败或已跳过的通知可补发",
        409,
      );
    }
    await this.repository.saveNotificationDelivery(organizationId, {
      ...delivery,
      status: "PENDING",
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: this.now(),
      sentAt: null,
      updatedAt: this.now(),
    });
  }

  private async deliver(
    organizationId: string,
    delivery: NotificationDelivery,
  ): Promise<void> {
    const templateId = this.templateConfig.templateIds[delivery.payload.type];
    const openId = await this.repository.getUserWechatOpenId(
      organizationId,
      delivery.userId,
    );
    if (!this.sender?.configured || !templateId || !openId) {
      await this.repository.saveNotificationDelivery(organizationId, {
        ...delivery,
        status: "SKIPPED",
        lastError: !this.sender?.configured
          ? "微信订阅消息未配置"
          : !templateId
            ? "该通知类型未配置微信模板"
            : "用户未绑定微信 OpenID",
        updatedAt: this.now(),
      });
      return;
    }

    const attemptCount = delivery.attemptCount + 1;
    try {
      await this.sender.send(openId, templateId, delivery.payload, this.templateConfig);
      await this.repository.saveNotificationDelivery(organizationId, {
        ...delivery,
        status: "SENT",
        attemptCount,
        lastError: null,
        sentAt: this.now(),
        updatedAt: this.now(),
      });
    } catch (error) {
      const terminal = attemptCount >= this.maxAttempts;
      await this.repository.saveNotificationDelivery(organizationId, {
        ...delivery,
        status: "FAILED",
        attemptCount,
        lastError: error instanceof Error ? error.message.slice(0, 1000) : "未知发送错误",
        nextAttemptAt: terminal
          ? new Date("9999-12-31T00:00:00.000Z")
          : new Date(this.now().getTime() + Math.min(60, 2 ** attemptCount) * 60_000),
        updatedAt: this.now(),
      });
    }
  }
}

export function parseWechatTemplateConfig(
  env: NodeJS.ProcessEnv,
): WechatTemplateConfig {
  const templateIds: Partial<Record<NotificationType, string>> = {};
  const entries: Array<[NotificationType, string | undefined]> = [
    ["BOOKING_CONFIRMED", env.WECHAT_TEMPLATE_BOOKING_CONFIRMED],
    ["BOOKING_CANCELLED", env.WECHAT_TEMPLATE_BOOKING_CANCELLED],
    ["SESSION_RESCHEDULED", env.WECHAT_TEMPLATE_SESSION_RESCHEDULED],
    ["SESSION_CANCELLED", env.WECHAT_TEMPLATE_SESSION_CANCELLED],
    ["SESSION_REMINDER_24H", env.WECHAT_TEMPLATE_SESSION_REMINDER_24H],
    ["SESSION_REMINDER_2H", env.WECHAT_TEMPLATE_SESSION_REMINDER_2H],
  ];
  for (const [type, templateId] of entries) {
    if (templateId) templateIds[type] = templateId;
  }
  return {
    templateIds,
    miniprogramState:
      (env.WECHAT_MINIPROGRAM_STATE as WechatTemplateConfig["miniprogramState"]) ??
      "formal",
    language: env.WECHAT_SUBSCRIBE_LANGUAGE ?? "zh_CN",
  };
}
