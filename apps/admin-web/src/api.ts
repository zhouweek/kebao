export type SessionStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "CLOSED"
  | "CANCELLED"
  | "FINISHED";

export interface CourseSession {
  id: string;
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  classroomId: string | null;
  classroomName: string | null;
  teacherId: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: SessionStatus;
  bookingOpensAt: string;
  bookingClosesAt: string;
  cancelDeadlineAt: string;
  bookedCount: number;
  remainingCapacity: number;
  seriesId?: string | null;
  occurrenceIndex?: number | null;
}

export interface CreateSessionInput {
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  classroomId?: string | null;
  classroomName?: string | null;
  teacherId: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status?: SessionStatus;
}

export interface CreateSeriesInput extends CreateSessionInput {
  recurrence: "WEEKLY";
  intervalWeeks: number;
  repeatCount: number;
  skipConflicts?: boolean;
}

export interface SeriesResult {
  series: { id: string; recurrence: "WEEKLY"; intervalWeeks: number; requestedCount: number } | null;
  sessions: CourseSession[];
  successDates: string[];
  conflicts: Array<{
    date: string;
    startsAt: string;
    endsAt: string;
    conflicts: Array<{
      sessionId: string;
      teacherConflict: boolean;
      classroomConflict: boolean;
    }>;
  }>;
}

export interface RescheduleSessionInput {
  startsAt: string;
  endsAt: string;
  teacherId?: string;
  teacherName?: string;
  classroomId?: string | null;
  classroomName?: string | null;
  scope?: "THIS" | "THIS_AND_FUTURE";
}

export type AttendanceStatus = "ATTENDED" | "LEAVE" | "ABSENT";
export type BookingStatus =
  | "CONFIRMED"
  | "CANCELLED"
  | "COURSE_CANCELLED"
  | AttendanceStatus;

export interface RosterStudent {
  id: string;
  name: string;
  guardianPhone: string;
  bookingId: string;
  bookingStatus: BookingStatus;
}

export interface Booking {
  id: string;
  sessionId: string;
  studentId: string;
  status: BookingStatus;
  createdAt: string;
}

export interface AdminBooking extends Booking {
  session: {
    id: string;
    courseId: string;
    courseName: string;
    startsAt: string;
    endsAt: string;
    status: SessionStatus;
  };
  student: {
    id: string;
    name: string;
    guardianPhone: string;
  };
  teacher: {
    id: string;
    name: string;
  };
}

export interface AdminBookingPage {
  items: AdminBooking[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminBookingQuery {
  page?: number;
  pageSize?: number;
  sessionId?: string;
  studentId?: string;
  status?: BookingStatus;
  from?: string;
  to?: string;
}

export interface Notification {
  id: string;
  userId: string;
  type:
    | "SESSION_RESCHEDULED"
    | "SESSION_CANCELLED"
    | "BOOKING_CONFIRMED"
    | "BOOKING_CANCELLED"
    | "SESSION_REMINDER_24H"
    | "SESSION_REMINDER_2H";
  title: string;
  content: string;
  sessionId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationDelivery {
  id: string;
  userId: string;
  channel: "WECHAT";
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  createdAt: string;
  notification: Pick<Notification, "title" | "content" | "type" | "createdAt">;
  user: { id: string; name: string; wechatOpenId: string | null };
}

export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  createdAt: string;
}

export interface AnalyticsFilter {
  from?: string;
  to?: string;
  campusId?: string;
  courseId?: string;
  teacherId?: string;
}

export interface AnalyticsMetrics {
  sessionCount: number;
  reservationCount: number;
  occupancyRate: number;
  cancellationRate: number;
  attendanceRate: number;
}

export interface AnalyticsDetail {
  sessionId: string;
  startsAt: string;
  courseId: string;
  courseName: string;
  campusId: string;
  campusName: string;
  teacherId: string;
  teacherName: string;
  capacity: number;
  reservationCount: number;
  activeBookingCount: number;
  cancelledBookingCount: number;
  attendedCount: number;
  leaveCount: number;
  absentCount: number;
  occupancyRate: number;
  cancellationRate: number;
  attendanceRate: number;
}

export interface AnalyticsResult {
  metrics: AnalyticsMetrics;
  details: AnalyticsDetail[];
  generatedAt: string;
  definitions: {
    sessions: string;
    reservations: string;
    occupancy: string;
    cancellation: string;
    attendance: string;
  };
}

export type MasterResource =
  | "campuses"
  | "classrooms"
  | "courses"
  | "teachers"
  | "guardians"
  | "students";

export interface MasterDataItem {
  id: string;
  name: string;
  isActive: boolean;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  timezone?: string;
  campusId?: string | null;
  campusName?: string | null;
  code?: string | null;
  capacity?: number;
  durationMinutes?: number;
  description?: string | null;
  specialty?: string | null;
  remark?: string | null;
  gender?: string | null;
  birthDate?: string | null;
  guardians?: Array<{
    id: string;
    name: string;
    phone: string | null;
    relationship: string;
    isPrimary: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface MasterDataPage {
  items: MasterDataItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: {
      conflicts?: Array<{
        sessionId?: string;
        teacherConflict?: boolean;
        classroomConflict?: boolean;
        date?: string;
        conflicts?: Array<{
          sessionId: string;
          teacherConflict: boolean;
          classroomConflict: boolean;
        }>;
      }>;
    };
  };
}

export interface AuthUser {
  id: string;
  organizationId: string;
  role: "ADMIN" | "TEACHER" | "GUARDIAN";
  name: string;
  phone: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface LoginResult extends AuthTokens {
  user: AuthUser;
}

const AUTH_STORAGE_KEY = "kebao.admin.auth";
const developmentIdentityHeaders = {
  "x-tenant-id": "org-development",
  "x-role": "ADMIN",
  "x-user-id": "admin-1",
};

function storedAuth(): LoginResult | undefined {
  try {
    const value = localStorage.getItem(AUTH_STORAGE_KEY);
    return value ? (JSON.parse(value) as LoginResult) : undefined;
  } catch {
    return undefined;
  }
}

export function saveAuth(result: LoginResult): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(result));
}

export function clearAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function hasAuth(): boolean {
  return Boolean(storedAuth()?.accessToken);
}

export function isDevelopmentIdentityEnabled(): boolean {
  return import.meta.env.VITE_DEV_IDENTITY_ENABLED === "true";
}

function authHeaders(): Record<string, string> {
  const token = storedAuth()?.accessToken;
  if (token) return { Authorization: `Bearer ${token}` };
  return isDevelopmentIdentityEnabled()
    ? developmentIdentityHeaders
    : {};
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: ApiErrorPayload["error"] extends infer T
      ? T extends { details?: infer D }
        ? D
        : never
      : never,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data?: T } & ApiErrorPayload;
  if (!response.ok) {
    throw new ApiError(
      body.error?.message ?? "请求失败，请稍后重试",
      body.error?.code ?? "UNKNOWN_ERROR",
      response.status,
      body.error?.details,
    );
  }
  if (body.data === undefined) {
    throw new ApiError("服务返回了无效数据", "INVALID_RESPONSE", response.status);
  }
  return body.data;
}

export async function loginAdmin(
  organizationCode: string,
  phone: string,
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<LoginResult> {
  const response = await fetcher("/auth/admin/login", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organizationCode, phone, password }),
  });
  const result = await parseResponse<LoginResult>(response);
  saveAuth(result);
  return result;
}

export async function refreshAccessToken(
  fetcher: typeof fetch = fetch,
): Promise<AuthTokens> {
  const current = storedAuth();
  if (!current) throw new ApiError("请先登录", "AUTH_REQUIRED", 401);
  const response = await fetcher("/auth/refresh", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  const tokens = await parseResponse<AuthTokens>(response);
  saveAuth({ ...current, ...tokens });
  return tokens;
}

let refreshInFlight: Promise<AuthTokens> | undefined;

async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const response = await fetcher(input, init);
  if (response.status !== 401) return response;

  const body = (await response.clone().json().catch(() => undefined)) as
    | ApiErrorPayload
    | undefined;
  if (body?.error?.code !== "TOKEN_EXPIRED") return response;

  refreshInFlight ??= refreshAccessToken(fetcher).finally(() => {
    refreshInFlight = undefined;
  });
  try {
    const tokens = await refreshInFlight;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    return fetcher(input, { ...init, headers });
  } catch (error) {
    clearAuth();
    throw error;
  }
}

export async function logout(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await fetcher("/auth/logout", {
      method: "POST",
      headers: { Accept: "application/json", ...authHeaders() },
    });
  } finally {
    clearAuth();
  }
}

export async function getMe(fetcher: typeof fetch = fetch): Promise<AuthUser> {
  const response = await authenticatedFetch("/auth/me", {
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<AuthUser>(response);
}

export async function getSessions(
  fetcher: typeof fetch = fetch,
): Promise<CourseSession[]> {
  const response = await authenticatedFetch("/sessions", {
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<CourseSession[]>(response);
}

export async function createSession(
  input: CreateSessionInput,
  fetcher: typeof fetch = fetch,
): Promise<CourseSession> {
  const response = await authenticatedFetch("/sessions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(input),
  }, fetcher);
  return parseResponse<CourseSession>(response);
}

export async function previewSeries(
  input: CreateSeriesInput,
  fetcher: typeof fetch = fetch,
): Promise<SeriesResult> {
  const response = await authenticatedFetch("/session-series/preflight", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  }, fetcher);
  return parseResponse<SeriesResult>(response);
}

export async function createSeries(
  input: CreateSeriesInput,
  fetcher: typeof fetch = fetch,
): Promise<SeriesResult> {
  const response = await authenticatedFetch("/session-series", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  }, fetcher);
  return parseResponse<SeriesResult>(response);
}

export async function getAdminBookings(
  query: AdminBookingQuery = {},
  fetcher: typeof fetch = fetch,
): Promise<AdminBookingPage> {
  const search = new URLSearchParams();
  if (query.page) search.set("page", String(query.page));
  if (query.pageSize) search.set("pageSize", String(query.pageSize));
  if (query.sessionId) search.set("sessionId", query.sessionId);
  if (query.studentId) search.set("studentId", query.studentId);
  if (query.status) search.set("status", query.status);
  if (query.from) search.set("from", query.from);
  if (query.to) search.set("to", query.to);
  const response = await authenticatedFetch(
    `/admin/bookings${search.size ? `?${search}` : ""}`,
    { headers: { Accept: "application/json", ...authHeaders() } },
    fetcher,
  );
  return parseResponse<AdminBookingPage>(response);
}

export async function createAdminBooking(
  sessionId: string,
  studentId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ booking: Booking; alreadyBooked: boolean }> {
  const response = await authenticatedFetch("/admin/bookings", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ sessionId, studentId }),
  }, fetcher);
  return parseResponse<{ booking: Booking; alreadyBooked: boolean }>(response);
}

export async function cancelAdminBooking(
  bookingId: string,
  reason: string,
  fetcher: typeof fetch = fetch,
): Promise<Booking> {
  const response = await authenticatedFetch(`/admin/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ reason }),
  }, fetcher);
  return parseResponse<Booking>(response);
}

function jsonHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...authHeaders(),
  };
}

export async function rescheduleSession(
  sessionId: string,
  input: RescheduleSessionInput,
  fetcher: typeof fetch = fetch,
): Promise<CourseSession | { sessions: CourseSession[] }> {
  const response = await authenticatedFetch(`/sessions/${sessionId}/reschedule`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  }, fetcher);
  return parseResponse<CourseSession | { sessions: CourseSession[] }>(response);
}

export async function cancelSession(
  sessionId: string,
  reason: string,
  fetcher: typeof fetch = fetch,
  scope: "THIS" | "THIS_AND_FUTURE" = "THIS",
): Promise<CourseSession | { sessions: CourseSession[] }> {
  const response = await authenticatedFetch(`/sessions/${sessionId}/cancel`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(scope === "THIS" ? { reason } : { reason, scope }),
  }, fetcher);
  return parseResponse<CourseSession | { sessions: CourseSession[] }>(response);
}

export async function getRoster(
  sessionId: string,
  fetcher: typeof fetch = fetch,
): Promise<RosterStudent[]> {
  const response = await authenticatedFetch(`/teacher/sessions/${sessionId}/roster`, {
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<RosterStudent[]>(response);
}

export async function updateAttendance(
  sessionId: string,
  records: Array<{ bookingId: string; status: AttendanceStatus }>,
  fetcher: typeof fetch = fetch,
): Promise<Booking[]> {
  const response = await authenticatedFetch(`/sessions/${sessionId}/attendance`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ records }),
  }, fetcher);
  return parseResponse<Booking[]>(response);
}

export async function getNotifications(
  unreadOnly = false,
  fetcher: typeof fetch = fetch,
): Promise<Notification[]> {
  const response = await authenticatedFetch(
    `/notifications${unreadOnly ? "?unreadOnly=true" : ""}`,
    { headers: { Accept: "application/json", ...authHeaders() } },
    fetcher,
  );
  return parseResponse<Notification[]>(response);
}

export async function markNotificationRead(
  notificationId: string,
  fetcher: typeof fetch = fetch,
): Promise<Notification> {
  const response = await authenticatedFetch(`/notifications/${notificationId}/read`, {
    method: "PATCH",
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<Notification>(response);
}

export async function getNotificationDeliveries(
  fetcher: typeof fetch = fetch,
): Promise<NotificationDelivery[]> {
  const response = await authenticatedFetch("/admin/notification-deliveries", {
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<NotificationDelivery[]>(response);
}

export async function resendNotificationDelivery(
  deliveryId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ accepted: boolean }> {
  const response = await authenticatedFetch(
    `/admin/notification-deliveries/${encodeURIComponent(deliveryId)}/resend`,
    { method: "POST", headers: jsonHeaders() },
    fetcher,
  );
  return parseResponse<{ accepted: boolean }>(response);
}

export async function getAuditLogs(
  fetcher: typeof fetch = fetch,
): Promise<AuditLog[]> {
  const response = await authenticatedFetch("/audit-logs", {
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<AuditLog[]>(response);
}

function analyticsSearch(filter: AnalyticsFilter): string {
  const search = new URLSearchParams();
  if (filter.from) search.set("from", filter.from);
  if (filter.to) search.set("to", filter.to);
  if (filter.campusId) search.set("campusId", filter.campusId);
  if (filter.courseId) search.set("courseId", filter.courseId);
  if (filter.teacherId) search.set("teacherId", filter.teacherId);
  return search.size ? `?${search}` : "";
}

export async function getStatistics(
  filter: AnalyticsFilter = {},
  fetcher: typeof fetch = fetch,
): Promise<AnalyticsResult> {
  const response = await authenticatedFetch(`/admin/statistics${analyticsSearch(filter)}`, {
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<AnalyticsResult>(response);
}

export async function exportStatisticsCsv(
  filter: AnalyticsFilter = {},
  fetcher: typeof fetch = fetch,
): Promise<{ blob: Blob; filename: string }> {
  const response = await authenticatedFetch(
    `/admin/statistics/export${analyticsSearch(filter)}`,
    { headers: { Accept: "text/csv", ...authHeaders() } },
    fetcher,
  );
  if (!response.ok) {
    let message = "导出失败，请稍后重试";
    let code = "EXPORT_FAILED";
    try {
      const body = (await response.json()) as ApiErrorPayload;
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
    } catch {
      // 非 JSON 错误响应使用通用文案。
    }
    throw new ApiError(message, code, response.status);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "statistics-details.csv";
  return { blob: await response.blob(), filename };
}

export async function getMasterData(
  resource: MasterResource,
  query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    activeOnly?: boolean;
    campusId?: string;
  } = {},
  fetcher: typeof fetch = fetch,
): Promise<MasterDataPage> {
  const search = new URLSearchParams();
  if (query.page) search.set("page", String(query.page));
  if (query.pageSize) search.set("pageSize", String(query.pageSize));
  if (query.keyword) search.set("keyword", query.keyword);
  if (query.activeOnly !== undefined) search.set("activeOnly", String(query.activeOnly));
  if (query.campusId) search.set("campusId", query.campusId);
  const suffix = search.size ? `?${search}` : "";
  const response = await authenticatedFetch(`/admin/${resource}${suffix}`, {
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  return parseResponse<MasterDataPage>(response);
}

export async function saveMasterData(
  resource: MasterResource,
  input: Record<string, unknown>,
  id?: string,
  fetcher: typeof fetch = fetch,
): Promise<MasterDataItem> {
  const response = await authenticatedFetch(`/admin/${resource}${id ? `/${id}` : ""}`, {
    method: id ? "PATCH" : "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  }, fetcher);
  return parseResponse<MasterDataItem>(response);
}

export async function setMasterDataActive(
  resource: MasterResource,
  id: string,
  isActive: boolean,
  fetcher: typeof fetch = fetch,
): Promise<MasterDataItem> {
  const response = await authenticatedFetch(`/admin/${resource}/${id}/status`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ isActive }),
  }, fetcher);
  return parseResponse<MasterDataItem>(response);
}

export async function deleteMasterData(
  resource: MasterResource,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await authenticatedFetch(`/admin/${resource}/${id}`, {
    method: "DELETE",
    headers: { Accept: "application/json", ...authHeaders() },
  }, fetcher);
  if (!response.ok) await parseResponse<never>(response);
}

export async function setStudentGuardians(
  studentId: string,
  guardians: Array<{ guardianId: string; relationship: string; isPrimary: boolean }>,
  fetcher: typeof fetch = fetch,
): Promise<MasterDataItem> {
  const response = await authenticatedFetch(`/admin/students/${studentId}/guardians`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ guardians }),
  }, fetcher);
  return parseResponse<MasterDataItem>(response);
}
