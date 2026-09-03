import { DomainError } from "./domain.js";
import type { NotificationDelivery } from "./domain.js";
import type {
  WechatSubscriptionSender,
  WechatTemplateConfig,
} from "./notification-worker.js";

interface WechatError {
  errcode?: number;
  errmsg?: string;
}

interface AccessTokenResponse extends WechatError {
  access_token?: string;
  expires_in?: number;
}

interface Code2SessionResponse extends WechatError {
  openid?: string;
}

interface PhoneResponse extends WechatError {
  phone_info?: {
    phoneNumber?: string;
    purePhoneNumber?: string;
  };
}

export interface WechatIdentity {
  openId: string;
  phone: string;
}

export interface WechatApiOptions {
  appId: string;
  appSecret: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

export class WechatApi implements WechatSubscriptionSender {
  readonly configured = true;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private accessToken?: { value: string; expiresAt: number };

  constructor(private readonly options: WechatApiOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async resolveIdentity(loginCode: string, phoneCode: string): Promise<WechatIdentity> {
    const [openId, phone] = await Promise.all([
      this.code2Session(loginCode),
      this.getPhoneNumber(phoneCode),
    ]);
    return { openId, phone };
  }

  async send(
    openId: string,
    templateId: string,
    payload: NotificationDelivery["payload"],
    config: Pick<WechatTemplateConfig, "miniprogramState" | "language">,
  ): Promise<void> {
    const accessToken = await this.getAccessToken();
    const response = await this.fetcher(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          touser: openId,
          template_id: templateId,
          page: payload.page,
          miniprogram_state: config.miniprogramState ?? "formal",
          lang: config.language ?? "zh_CN",
          data: {
            thing1: { value: payload.title.slice(0, 20) },
            thing2: { value: payload.content.slice(0, 20) },
          },
        }),
      },
    );
    const body = (await response.json()) as WechatError;
    if (!response.ok || body.errcode !== 0) {
      throw this.wechatError(
        "WECHAT_SUBSCRIBE_SEND_FAILED",
        "微信订阅消息发送失败",
        response,
        body,
        503,
      );
    }
  }

  private async code2Session(code: string): Promise<string> {
    const query = new URLSearchParams({
      appid: this.options.appId,
      secret: this.options.appSecret,
      js_code: code,
      grant_type: "authorization_code",
    });
    const response = await this.fetcher(
      `https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`,
    );
    const body = (await response.json()) as Code2SessionResponse;
    if (!response.ok || !body.openid) {
      throw this.wechatError("WECHAT_CODE_INVALID", "微信登录凭证校验失败", response, body);
    }
    return body.openid;
  }

  private async getPhoneNumber(code: string): Promise<string> {
    const accessToken = await this.getAccessToken();
    const response = await this.fetcher(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
    );
    const body = (await response.json()) as PhoneResponse;
    const phone = body.phone_info?.purePhoneNumber ?? body.phone_info?.phoneNumber;
    if (!response.ok || body.errcode !== 0 || !phone) {
      throw this.wechatError(
        "WECHAT_PHONE_INVALID",
        "微信手机号凭证校验失败",
        response,
        body,
      );
    }
    return phone;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > this.now()) {
      return this.accessToken.value;
    }
    const query = new URLSearchParams({
      grant_type: "client_credential",
      appid: this.options.appId,
      secret: this.options.appSecret,
    });
    const response = await this.fetcher(
      `https://api.weixin.qq.com/cgi-bin/token?${query.toString()}`,
    );
    const body = (await response.json()) as AccessTokenResponse;
    if (!response.ok || !body.access_token) {
      throw this.wechatError(
        "WECHAT_ACCESS_TOKEN_FAILED",
        "微信服务访问凭证获取失败",
        response,
        body,
        503,
      );
    }
    const ttlSeconds = Math.max(60, (body.expires_in ?? 7200) - 300);
    this.accessToken = {
      value: body.access_token,
      expiresAt: this.now() + ttlSeconds * 1000,
    };
    return body.access_token;
  }

  private wechatError(
    code: string,
    message: string,
    response: Response,
    body: WechatError,
    statusCode = 401,
  ): DomainError {
    const detail = `${body.errcode ?? response.status} ${body.errmsg ?? ""}`.trim();
    return new DomainError(code, `${message}：${detail}`, statusCode);
  }
}
