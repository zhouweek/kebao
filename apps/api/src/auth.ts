import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { DomainError, type UserIdentity, type UserRole } from "./domain.js";

const scrypt = promisify(nodeScrypt);

export interface AuthUser extends UserIdentity {
  name: string;
  phone: string | null;
  passwordHash: string | null;
  wechatOpenId: string | null;
  isActive: boolean;
}

export interface AuthSession {
  id: string;
  userId: string;
  organizationId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthRepository {
  findAuthUserByOrganizationCodeAndPhone(
    organizationCode: string,
    phone: string,
    role?: UserRole,
  ): Promise<AuthUser | undefined>;
  getAuthUser(userId: string, organizationId: string): Promise<AuthUser | undefined>;
  bindWechatOpenId(userId: string, organizationId: string, openId: string): Promise<void>;
  createAuthSession(session: AuthSession): Promise<void>;
  getAuthSessionById(id: string): Promise<AuthSession | undefined>;
  getAuthSessionByRefreshTokenHash(hash: string): Promise<AuthSession | undefined>;
  rotateAuthSession(id: string, refreshTokenHash: string, expiresAt: Date): Promise<void>;
  revokeAuthSession(id: string): Promise<void>;
  touchUserLastLogin(userId: string, organizationId: string, at: Date): Promise<void>;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

interface AccessPayload {
  sub: string;
  org: string;
  role: UserRole;
  sid: string;
  typ: "access";
  iat: number;
  exp: number;
}

export interface AuthServiceOptions {
  tokenSecret: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  now?: () => Date;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function hashPasswordForDevelopment(password: string): string {
  const salt = Buffer.from("kebao-development");
  const derived = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class AuthService {
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: AuthRepository,
    private readonly options: AuthServiceOptions,
  ) {
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 15 * 60;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds ?? 30 * 24 * 60 * 60;
    this.now = options.now ?? (() => new Date());
  }

  async loginAdmin(
    organizationCode: string,
    phone: string,
    password: string,
  ): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const user = await this.repository.findAuthUserByOrganizationCodeAndPhone(
      organizationCode,
      phone,
      "ADMIN",
    );
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new DomainError("INVALID_CREDENTIALS", "手机号或密码错误", 401);
    }
    return this.completeLogin(user);
  }

  async loginWechat(
    organizationCode: string,
    phone: string,
    openId: string,
  ): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const user = await this.repository.findAuthUserByOrganizationCodeAndPhone(
      organizationCode,
      phone,
    );
    if (!user || user.role === "ADMIN") {
      throw new DomainError("WECHAT_USER_NOT_FOUND", "手机号未匹配到可登录用户", 401);
    }
    if (user.wechatOpenId && user.wechatOpenId !== openId) {
      throw new DomainError("WECHAT_IDENTITY_MISMATCH", "微信身份与手机号不匹配", 401);
    }
    if (!user.wechatOpenId) {
      await this.repository.bindWechatOpenId(user.id, user.organizationId, openId);
      user.wechatOpenId = openId;
    }
    return this.completeLogin(user);
  }

  async authenticate(accessToken: string): Promise<AuthUser> {
    const payload = this.verifyAccessToken(accessToken);
    const [session, user] = await Promise.all([
      this.repository.getAuthSessionById(payload.sid),
      this.repository.getAuthUser(payload.sub, payload.org),
    ]);
    if (!session || session.revokedAt || session.expiresAt <= this.now()) {
      throw new DomainError("SESSION_INVALID", "登录会话已失效", 401);
    }
    if (!user || !user.isActive) {
      throw new DomainError("USER_DISABLED", "用户已停用", 403);
    }
    if (user.role !== payload.role) {
      throw new DomainError("TOKEN_INVALID", "访问令牌身份无效", 401);
    }
    return user;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = hashToken(refreshToken);
    const session = await this.repository.getAuthSessionByRefreshTokenHash(hash);
    if (!session || session.revokedAt || session.expiresAt <= this.now()) {
      throw new DomainError("REFRESH_TOKEN_INVALID", "刷新令牌无效或已过期", 401);
    }
    const user = await this.repository.getAuthUser(session.userId, session.organizationId);
    if (!user || !user.isActive) {
      throw new DomainError("USER_DISABLED", "用户已停用", 403);
    }
    const tokens = this.createTokenPair(user, session.id);
    await this.repository.rotateAuthSession(
      session.id,
      hashToken(tokens.refreshToken),
      new Date(this.now().getTime() + this.refreshTokenTtlSeconds * 1000),
    );
    return tokens;
  }

  async logout(accessToken: string): Promise<void> {
    const payload = this.verifyAccessToken(accessToken, true);
    await this.repository.revokeAuthSession(payload.sid);
  }

  private async completeLogin(user: AuthUser): Promise<{ user: AuthUser; tokens: TokenPair }> {
    if (!user.isActive) {
      throw new DomainError("USER_DISABLED", "用户已停用", 403);
    }
    const sessionId = randomUUID();
    const tokens = this.createTokenPair(user, sessionId);
    const now = this.now();
    await this.repository.createAuthSession({
      id: sessionId,
      userId: user.id,
      organizationId: user.organizationId,
      refreshTokenHash: hashToken(tokens.refreshToken),
      expiresAt: new Date(now.getTime() + this.refreshTokenTtlSeconds * 1000),
      revokedAt: null,
    });
    await this.repository.touchUserLastLogin(user.id, user.organizationId, now);
    return { user, tokens };
  }

  private createTokenPair(user: AuthUser, sessionId: string): TokenPair {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const payload: AccessPayload = {
      sub: user.id,
      org: user.organizationId,
      role: user.role,
      sid: sessionId,
      typ: "access",
      iat: nowSeconds,
      exp: nowSeconds + this.accessTokenTtlSeconds,
    };
    const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64Url(JSON.stringify(payload));
    const signature = createHmac("sha256", this.options.tokenSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return {
      accessToken: `${header}.${body}.${signature}`,
      refreshToken: `${sessionId}.${randomBytes(32).toString("base64url")}`,
      accessTokenExpiresIn: this.accessTokenTtlSeconds,
    };
  }

  private verifyAccessToken(token: string, allowExpired = false): AccessPayload {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) {
      throw new DomainError("TOKEN_INVALID", "访问令牌无效", 401);
    }
    const expected = createHmac("sha256", this.options.tokenSecret)
      .update(`${header}.${body}`)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new DomainError("TOKEN_INVALID", "访问令牌无效", 401);
    }
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessPayload;
      if (
        payload.typ !== "access" ||
        !payload.sub ||
        !payload.org ||
        !payload.sid ||
        !["ADMIN", "TEACHER", "GUARDIAN"].includes(payload.role)
      ) {
        throw new Error("载荷无效");
      }
      if (!allowExpired && payload.exp <= Math.floor(this.now().getTime() / 1000)) {
        throw new DomainError("TOKEN_EXPIRED", "访问令牌已过期", 401);
      }
      return payload;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("TOKEN_INVALID", "访问令牌无效", 401);
    }
  }
}
