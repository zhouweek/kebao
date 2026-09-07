import { ApiError } from "./api";

export interface PlatformUser {
  id: string;
  username: string;
  name: string;
  isActive: boolean;
  mustChangePassword?: boolean;
}

export interface PlatformTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface PlatformLoginResult extends PlatformTokens {
  account: PlatformUser;
}

export interface Organization {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrganizationAdmin {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email?: string | null;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TemporaryPasswordResult {
  temporaryPassword: string;
}

export interface PlatformAuditLog {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  createdAt: string;
}

export const PLATFORM_AUTH_STORAGE_KEY = "kebao.platform.auth";
export const PLATFORM_AUTH_CLEARED_EVENT = "kebao:platform-auth-cleared";
let platformAuthGeneration = 0;

export interface PlatformAuthSnapshot {
  generation: number;
  accessToken: string | undefined;
  refreshToken: string | undefined;
}

function storedPlatformAuth(): PlatformLoginResult | undefined {
  try {
    const value = localStorage.getItem(PLATFORM_AUTH_STORAGE_KEY);
    return value ? JSON.parse(value) as PlatformLoginResult : undefined;
  } catch {
    return undefined;
  }
}

export function savePlatformAuth(auth: PlatformLoginResult): void {
  platformAuthGeneration += 1;
  localStorage.setItem(PLATFORM_AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearPlatformAuth(): void {
  platformAuthGeneration += 1;
  localStorage.removeItem(PLATFORM_AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event(PLATFORM_AUTH_CLEARED_EVENT));
}

export function invalidatePlatformAuthSnapshots(): void {
  platformAuthGeneration += 1;
}

export function getPlatformAuthSnapshot(): PlatformAuthSnapshot {
  const auth = storedPlatformAuth();
  return {
    generation: platformAuthGeneration,
    accessToken: auth?.accessToken,
    refreshToken: auth?.refreshToken,
  };
}

export function isPlatformAuthSnapshotCurrent(snapshot: PlatformAuthSnapshot): boolean {
  const auth = storedPlatformAuth();
  return (
    snapshot.generation === platformAuthGeneration &&
    snapshot.accessToken === auth?.accessToken &&
    snapshot.refreshToken === auth?.refreshToken
  );
}

function clearPlatformAuthIfCurrent(snapshot: PlatformAuthSnapshot): void {
  if (isPlatformAuthSnapshotCurrent(snapshot)) clearPlatformAuth();
}

function updatePlatformAuthForSnapshot(
  snapshot: PlatformAuthSnapshot,
  current: PlatformLoginResult,
  tokens: PlatformTokens,
): boolean {
  if (!isPlatformAuthSnapshotCurrent(snapshot)) return false;
  localStorage.setItem(PLATFORM_AUTH_STORAGE_KEY, JSON.stringify({ ...current, ...tokens }));
  return true;
}

export function getStoredPlatformAuth(): PlatformLoginResult | undefined {
  return storedPlatformAuth();
}

export function hasPlatformAuth(): boolean {
  return Boolean(storedPlatformAuth()?.accessToken);
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = await response.json() as { data?: T } & ErrorPayload;
  if (!response.ok) {
    throw new ApiError(
      body.error?.message ?? "请求失败，请稍后重试",
      body.error?.code ?? "UNKNOWN_ERROR",
      response.status,
    );
  }
  if (body.data === undefined) {
    throw new ApiError("服务返回了无效数据", "INVALID_RESPONSE", response.status);
  }
  return body.data;
}

function platformHeaders(json = false): Record<string, string> {
  const token = storedPlatformAuth()?.accessToken;
  return {
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

let platformRefreshInFlight:
  | { snapshot: PlatformAuthSnapshot; promise: Promise<PlatformTokens> }
  | undefined;

function samePlatformAuthSnapshot(
  first: PlatformAuthSnapshot,
  second: PlatformAuthSnapshot,
): boolean {
  return (
    first.generation === second.generation &&
    first.accessToken === second.accessToken &&
    first.refreshToken === second.refreshToken
  );
}

function isRefreshedPlatformAuthCurrent(
  snapshot: PlatformAuthSnapshot,
  tokens: PlatformTokens,
): boolean {
  const current = getPlatformAuthSnapshot();
  return (
    current.generation === snapshot.generation &&
    current.accessToken === tokens.accessToken &&
    current.refreshToken === tokens.refreshToken
  );
}

export async function refreshPlatformAccessToken(
  fetcher: typeof fetch = fetch,
  snapshot: PlatformAuthSnapshot = getPlatformAuthSnapshot(),
): Promise<PlatformTokens> {
  const current = storedPlatformAuth();
  if (!current) throw new ApiError("请先登录", "AUTH_REQUIRED", 401);
  const response = await fetcher("/platform/auth/refresh", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  const tokens = await parseResponse<PlatformTokens>(response);
  const latest = storedPlatformAuth();
  if (
    isPlatformAuthSnapshotCurrent(snapshot) &&
    latest?.accessToken === current.accessToken &&
    latest.refreshToken === current.refreshToken
  ) {
    updatePlatformAuthForSnapshot(snapshot, current, tokens);
  }
  return tokens;
}

async function platformFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const authSnapshot = getPlatformAuthSnapshot();
  const response = await fetcher(input, init);
  if (response.status !== 401) return response;
  const body = await response.clone().json().catch(() => undefined) as ErrorPayload | undefined;
  if (body?.error?.code !== "TOKEN_EXPIRED") {
    clearPlatformAuthIfCurrent(authSnapshot);
    return response;
  }
  if (!isPlatformAuthSnapshotCurrent(authSnapshot)) return response;
  if (
    !platformRefreshInFlight ||
    !samePlatformAuthSnapshot(platformRefreshInFlight.snapshot, authSnapshot)
  ) {
    let promise: Promise<PlatformTokens>;
    promise = refreshPlatformAccessToken(fetcher, authSnapshot).finally(() => {
      if (platformRefreshInFlight?.promise === promise) platformRefreshInFlight = undefined;
    });
    platformRefreshInFlight = { snapshot: authSnapshot, promise };
  }
  try {
    const tokens = await platformRefreshInFlight.promise;
    if (!isRefreshedPlatformAuthCurrent(authSnapshot, tokens)) return response;
    const retrySnapshot = getPlatformAuthSnapshot();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    const retriedResponse = await fetcher(input, { ...init, headers });
    if (retriedResponse.status === 401) clearPlatformAuthIfCurrent(retrySnapshot);
    return retriedResponse;
  } catch (error) {
    clearPlatformAuthIfCurrent(authSnapshot);
    throw error;
  }
}

export async function loginPlatform(
  username: string,
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<PlatformLoginResult> {
  const authSnapshot = getPlatformAuthSnapshot();
  const response = await fetcher("/platform/auth/login", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const result = await parseResponse<PlatformLoginResult>(response);
  if (!isPlatformAuthSnapshotCurrent(authSnapshot)) {
    throw new ApiError("登录状态已变更，请重试", "AUTH_CHANGED", 409);
  }
  savePlatformAuth(result);
  return result;
}

export async function getPlatformMe(fetcher: typeof fetch = fetch): Promise<PlatformUser> {
  return parseResponse<PlatformUser>(await platformFetch(
    "/platform/auth/me",
    { headers: platformHeaders() },
    fetcher,
  ));
}

export async function changePlatformPassword(
  currentPassword: string,
  newPassword: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await parseResponse<void>(await platformFetch(
    "/platform/auth/change-password",
    {
      method: "POST",
      headers: platformHeaders(true),
      body: JSON.stringify({ currentPassword, newPassword }),
    },
    fetcher,
  ));
}

export async function logoutPlatform(fetcher: typeof fetch = fetch): Promise<void> {
  const authSnapshot = getPlatformAuthSnapshot();
  try {
    await platformFetch(
      "/platform/auth/logout",
      { method: "POST", headers: platformHeaders() },
      fetcher,
    );
  } finally {
    clearPlatformAuthIfCurrent(authSnapshot);
  }
}

export async function listOrganizations(fetcher: typeof fetch = fetch): Promise<Organization[]> {
  const result = await parseResponse<Organization[] | PageResult<Organization>>(
    await platformFetch("/platform/organizations", { headers: platformHeaders() }, fetcher),
  );
  return Array.isArray(result) ? result : result.items;
}

export async function saveOrganization(
  input: Pick<Organization, "code" | "name">,
  id?: string,
  fetcher: typeof fetch = fetch,
): Promise<Organization> {
  return parseResponse<Organization>(await platformFetch(
    `/platform/organizations${id ? `/${encodeURIComponent(id)}` : ""}`,
    {
      method: id ? "PATCH" : "POST",
      headers: platformHeaders(true),
      body: JSON.stringify(input),
    },
    fetcher,
  ));
}

export async function setOrganizationActive(
  id: string,
  isActive: boolean,
  fetcher: typeof fetch = fetch,
): Promise<Organization> {
  return parseResponse<Organization>(await platformFetch(
    `/platform/organizations/${encodeURIComponent(id)}/status`,
    { method: "PATCH", headers: platformHeaders(true), body: JSON.stringify({ isActive }) },
    fetcher,
  ));
}

export async function deleteOrganization(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await parseResponse<void>(await platformFetch(
    `/platform/organizations/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: platformHeaders() },
    fetcher,
  ));
}

export async function listOrganizationAdmins(
  organizationId: string,
  fetcher: typeof fetch = fetch,
): Promise<OrganizationAdmin[]> {
  const result = await parseResponse<OrganizationAdmin[] | PageResult<OrganizationAdmin>>(
    await platformFetch(
      `/platform/organizations/${encodeURIComponent(organizationId)}/admins`,
      { headers: platformHeaders() },
      fetcher,
    ),
  );
  return Array.isArray(result) ? result : result.items;
}

export async function saveOrganizationAdmin(
  organizationId: string,
  input: { name: string; phone: string; email?: string | null },
  id?: string,
  fetcher: typeof fetch = fetch,
): Promise<OrganizationAdmin & Partial<TemporaryPasswordResult>> {
  const result = await parseResponse<
    (OrganizationAdmin & Partial<TemporaryPasswordResult>) |
    { admin: OrganizationAdmin; temporaryPassword?: string }
  >(await platformFetch(
    `/platform/organizations/${encodeURIComponent(organizationId)}/admins${id ? `/${encodeURIComponent(id)}` : ""}`,
    {
      method: id ? "PATCH" : "POST",
      headers: platformHeaders(true),
      body: JSON.stringify(input),
    },
    fetcher,
  ));
  return "admin" in result
    ? { ...result.admin, ...(result.temporaryPassword ? { temporaryPassword: result.temporaryPassword } : {}) }
    : result;
}

export async function setOrganizationAdminActive(
  organizationId: string,
  adminId: string,
  isActive: boolean,
  fetcher: typeof fetch = fetch,
): Promise<OrganizationAdmin> {
  return parseResponse(await platformFetch(
    `/platform/organizations/${encodeURIComponent(organizationId)}/admins/${encodeURIComponent(adminId)}/status`,
    { method: "PATCH", headers: platformHeaders(true), body: JSON.stringify({ isActive }) },
    fetcher,
  ));
}

export async function resetOrganizationAdminPassword(
  organizationId: string,
  adminId: string,
  fetcher: typeof fetch = fetch,
): Promise<TemporaryPasswordResult> {
  return parseResponse<TemporaryPasswordResult>(await platformFetch(
    `/platform/organizations/${encodeURIComponent(organizationId)}/admins/${encodeURIComponent(adminId)}/reset-password`,
    {
      method: "POST",
      headers: platformHeaders(),
    },
    fetcher,
  ));
}

export async function revokeOrganizationAdminSessions(
  organizationId: string,
  adminId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await parseResponse<void>(await platformFetch(
    `/platform/organizations/${encodeURIComponent(organizationId)}/admins/${encodeURIComponent(adminId)}/revoke-sessions`,
    { method: "POST", headers: platformHeaders() },
    fetcher,
  ));
}

export async function listPlatformAuditLogs(
  limit = 100,
  fetcher: typeof fetch = fetch,
): Promise<PlatformAuditLog[]> {
  return parseResponse<PlatformAuditLog[]>(await platformFetch(
    `/platform/audit-logs?limit=${encodeURIComponent(String(limit))}`,
    { headers: platformHeaders() },
    fetcher,
  ));
}
