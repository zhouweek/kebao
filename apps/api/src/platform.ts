import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { DomainError } from "./domain.js";
import { hashPassword, verifyPassword } from "./auth.js";

export interface PlatformAccount {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface PlatformSession {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PlatformOrganization {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformTenantAdmin {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformAudit {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  createdAt: Date;
}

export interface PlatformRepository {
  withTransaction<T>(action: () => Promise<T>): Promise<T>;
  findPlatformAccount(username: string): Promise<PlatformAccount | undefined>;
  getPlatformAccount(id: string): Promise<PlatformAccount | undefined>;
  createPlatformSession(session: PlatformSession): Promise<void>;
  getPlatformSessionById(id: string): Promise<PlatformSession | undefined>;
  getPlatformSessionByRefreshTokenHash(hash: string): Promise<PlatformSession | undefined>;
  rotatePlatformSession(
    id: string,
    expectedHash: string,
    hash: string,
    expiresAt: Date,
  ): Promise<boolean>;
  revokePlatformSession(id: string): Promise<void>;
  revokeAllPlatformSessions(accountId: string): Promise<void>;
  touchPlatformLastLogin(accountId: string, at: Date): Promise<void>;
  updatePlatformPassword(
    accountId: string,
    expectedPasswordHash: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<boolean>;
  listPlatformOrganizations(includeDeleted?: boolean): Promise<PlatformOrganization[]>;
  getPlatformOrganization(id: string, includeDeleted?: boolean): Promise<PlatformOrganization | undefined>;
  createPlatformOrganization(input: { id: string; code: string; name: string }): Promise<PlatformOrganization>;
  updatePlatformOrganization(id: string, input: { code?: string; name?: string }): Promise<PlatformOrganization>;
  setPlatformOrganizationActive(id: string, isActive: boolean): Promise<PlatformOrganization>;
  softDeletePlatformOrganization(id: string): Promise<void>;
  listPlatformTenantAdmins(organizationId: string): Promise<PlatformTenantAdmin[]>;
  createPlatformTenantAdmin(input: {
    id: string;
    organizationId: string;
    name: string;
    phone: string;
    email?: string | null;
    passwordHash: string;
  }): Promise<PlatformTenantAdmin>;
  updatePlatformTenantAdmin(
    organizationId: string,
    userId: string,
    input: { name?: string; phone?: string; email?: string | null },
  ): Promise<PlatformTenantAdmin>;
  setPlatformTenantAdminActive(
    organizationId: string,
    userId: string,
    isActive: boolean,
  ): Promise<PlatformTenantAdmin>;
  resetPlatformTenantAdminPassword(
    organizationId: string,
    userId: string,
    passwordHash: string,
  ): Promise<void>;
  revokeTenantUserSessions(organizationId: string, userId: string): Promise<void>;
  savePlatformAudit(log: PlatformAudit): Promise<void>;
  listPlatformAudits(limit: number): Promise<PlatformAudit[]>;
}

export interface PlatformTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

interface PlatformPayload {
  sub: string;
  sid: string;
  aud: "platform";
  typ: "access";
  iat: number;
  exp: number;
}

const base64Url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class PlatformService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: PlatformRepository,
    private readonly tokenSecret: string,
    options: {
      accessTokenTtlSeconds?: number;
      refreshTokenTtlSeconds?: number;
      now?: () => Date;
    } = {},
  ) {
    this.accessTtl = options.accessTokenTtlSeconds ?? 15 * 60;
    this.refreshTtl = options.refreshTokenTtlSeconds ?? 30 * 24 * 60 * 60;
    this.now = options.now ?? (() => new Date());
  }

  async login(username: string, password: string) {
    return this.repository.withTransaction(async () => {
      const account = await this.repository.findPlatformAccount(username);
      if (!account || !(await verifyPassword(password, account.passwordHash))) {
        throw new DomainError("INVALID_CREDENTIALS", "账号或密码错误", 401);
      }
      if (!account.isActive) {
        throw new DomainError("PLATFORM_ACCOUNT_DISABLED", "平台账号已停用", 403);
      }
      const result = await this.issue(account);
      await this.repository.touchPlatformLastLogin(account.id, this.now());
      await this.audit(account.id, "PLATFORM_LOGIN", "PlatformAccount", account.id, {});
      return result;
    });
  }

  async authenticate(token: string): Promise<PlatformAccount> {
    const payload = this.verify(token);
    const [session, account] = await Promise.all([
      this.repository.getPlatformSessionById(payload.sid),
      this.repository.getPlatformAccount(payload.sub),
    ]);
    if (!session || session.accountId !== payload.sub || session.revokedAt || session.expiresAt <= this.now()) {
      throw new DomainError("SESSION_INVALID", "平台登录会话已失效", 401);
    }
    if (!account?.isActive) {
      throw new DomainError("PLATFORM_ACCOUNT_DISABLED", "平台账号已停用", 403);
    }
    return account;
  }

  async refresh(refreshToken: string): Promise<PlatformTokenPair> {
    const currentHash = hashToken(refreshToken);
    const session = await this.repository.getPlatformSessionByRefreshTokenHash(currentHash);
    if (!session || session.revokedAt || session.expiresAt <= this.now()) {
      throw new DomainError("REFRESH_TOKEN_INVALID", "平台刷新令牌无效或已过期", 401);
    }
    const account = await this.repository.getPlatformAccount(session.accountId);
    if (!account?.isActive) {
      throw new DomainError("PLATFORM_ACCOUNT_DISABLED", "平台账号已停用", 403);
    }
    const tokens = this.createTokens(account.id, session.id);
    const rotated = await this.repository.rotatePlatformSession(
      session.id,
      currentHash,
      hashToken(tokens.refreshToken),
      new Date(this.now().getTime() + this.refreshTtl * 1000),
    );
    if (!rotated) {
      throw new DomainError("REFRESH_TOKEN_INVALID", "平台刷新令牌无效或已过期", 401);
    }
    return tokens;
  }

  async logout(token: string): Promise<void> {
    const payload = this.verify(token, true);
    await this.repository.revokePlatformSession(payload.sid);
  }

  async changePassword(account: PlatformAccount, currentPassword: string, newPassword: string): Promise<void> {
    await this.repository.withTransaction(async () => {
      const current = await this.repository.getPlatformAccount(account.id);
      if (!current || !(await verifyPassword(currentPassword, current.passwordHash))) {
        throw new DomainError("CURRENT_PASSWORD_INVALID", "当前密码错误", 400);
      }
      if (await verifyPassword(newPassword, current.passwordHash)) {
        throw new DomainError(
          "NEW_PASSWORD_MUST_DIFFER",
          "新密码不能与当前密码相同",
          400,
        );
      }
      const updated = await this.repository.updatePlatformPassword(
        account.id,
        current.passwordHash,
        await hashPassword(newPassword),
        false,
      );
      if (!updated) {
        throw new DomainError("CURRENT_PASSWORD_INVALID", "当前密码已变更，请重新登录", 400);
      }
      await this.repository.revokeAllPlatformSessions(account.id);
      await this.audit(account.id, "PLATFORM_PASSWORD_CHANGED", "PlatformAccount", account.id, {});
    });
  }

  async audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: unknown,
  ): Promise<void> {
    await this.repository.savePlatformAudit({
      id: randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      details,
      createdAt: this.now(),
    });
  }

  private async issue(account: PlatformAccount) {
    const sessionId = randomUUID();
    const tokens = this.createTokens(account.id, sessionId);
    await this.repository.createPlatformSession({
      id: sessionId,
      accountId: account.id,
      refreshTokenHash: hashToken(tokens.refreshToken),
      expiresAt: new Date(this.now().getTime() + this.refreshTtl * 1000),
      revokedAt: null,
    });
    return { account, tokens };
  }

  private createTokens(accountId: string, sessionId: string): PlatformTokenPair {
    const now = Math.floor(this.now().getTime() / 1000);
    const payload: PlatformPayload = {
      sub: accountId,
      sid: sessionId,
      aud: "platform",
      typ: "access",
      iat: now,
      exp: now + this.accessTtl,
    };
    const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64Url(JSON.stringify(payload));
    const signature = createHmac("sha256", this.tokenSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return {
      accessToken: `${header}.${body}.${signature}`,
      refreshToken: `${sessionId}.${randomBytes(32).toString("base64url")}`,
      accessTokenExpiresIn: this.accessTtl,
    };
  }

  private verify(token: string, allowExpired = false): PlatformPayload {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) {
      throw new DomainError("TOKEN_INVALID", "平台访问令牌无效", 401);
    }
    const expected = createHmac("sha256", this.tokenSecret).update(`${header}.${body}`).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new DomainError("TOKEN_INVALID", "平台访问令牌无效", 401);
    }
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PlatformPayload;
      if (payload.aud !== "platform" || payload.typ !== "access" || !payload.sub || !payload.sid) {
        throw new Error("invalid payload");
      }
      if (!allowExpired && payload.exp <= Math.floor(this.now().getTime() / 1000)) {
        throw new DomainError("TOKEN_EXPIRED", "平台访问令牌已过期", 401);
      }
      return payload;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("TOKEN_INVALID", "平台访问令牌无效", 401);
    }
  }
}
