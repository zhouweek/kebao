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

export interface RescheduleSessionInput {
  startsAt: string;
  endsAt: string;
  teacherId?: string;
  teacherName?: string;
  classroomId?: string | null;
  classroomName?: string | null;
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

export interface Notification {
  id: string;
  userId: string;
  type: "SESSION_RESCHEDULED" | "SESSION_CANCELLED";
  title: string;
  content: string;
  sessionId: string | null;
  readAt: string | null;
  createdAt: string;
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

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: {
      conflicts?: Array<{
        sessionId: string;
        teacherConflict: boolean;
        classroomConflict: boolean;
      }>;
    };
  };
}

const developmentIdentityHeaders = {
  "x-tenant-id": "org-development",
  "x-role": "ADMIN",
  "x-user-id": "admin-1",
};

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

export async function getSessions(
  fetcher: typeof fetch = fetch,
): Promise<CourseSession[]> {
  const response = await fetcher("/sessions", {
    headers: { Accept: "application/json", ...developmentIdentityHeaders },
  });
  return parseResponse<CourseSession[]>(response);
}

export async function createSession(
  input: CreateSessionInput,
  fetcher: typeof fetch = fetch,
): Promise<CourseSession> {
  const response = await fetcher("/sessions", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...developmentIdentityHeaders,
    },
    body: JSON.stringify(input),
  });
  return parseResponse<CourseSession>(response);
}

function jsonHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...developmentIdentityHeaders,
  };
}

export async function rescheduleSession(
  sessionId: string,
  input: RescheduleSessionInput,
  fetcher: typeof fetch = fetch,
): Promise<CourseSession> {
  const response = await fetcher(`/sessions/${sessionId}/reschedule`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  return parseResponse<CourseSession>(response);
}

export async function cancelSession(
  sessionId: string,
  reason: string,
  fetcher: typeof fetch = fetch,
): Promise<CourseSession> {
  const response = await fetcher(`/sessions/${sessionId}/cancel`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ reason }),
  });
  return parseResponse<CourseSession>(response);
}

export async function getRoster(
  sessionId: string,
  fetcher: typeof fetch = fetch,
): Promise<RosterStudent[]> {
  const response = await fetcher(`/teacher/sessions/${sessionId}/roster`, {
    headers: { Accept: "application/json", ...developmentIdentityHeaders },
  });
  return parseResponse<RosterStudent[]>(response);
}

export async function updateAttendance(
  sessionId: string,
  records: Array<{ bookingId: string; status: AttendanceStatus }>,
  fetcher: typeof fetch = fetch,
): Promise<Booking[]> {
  const response = await fetcher(`/sessions/${sessionId}/attendance`, {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify({ records }),
  });
  return parseResponse<Booking[]>(response);
}

export async function getNotifications(
  unreadOnly = false,
  fetcher: typeof fetch = fetch,
): Promise<Notification[]> {
  const response = await fetcher(`/notifications${unreadOnly ? "?unreadOnly=true" : ""}`, {
    headers: { Accept: "application/json", ...developmentIdentityHeaders },
  });
  return parseResponse<Notification[]>(response);
}

export async function markNotificationRead(
  notificationId: string,
  fetcher: typeof fetch = fetch,
): Promise<Notification> {
  const response = await fetcher(`/notifications/${notificationId}/read`, {
    method: "PATCH",
    headers: { Accept: "application/json", ...developmentIdentityHeaders },
  });
  return parseResponse<Notification>(response);
}

export async function getAuditLogs(
  fetcher: typeof fetch = fetch,
): Promise<AuditLog[]> {
  const response = await fetcher("/audit-logs", {
    headers: { Accept: "application/json", ...developmentIdentityHeaders },
  });
  return parseResponse<AuditLog[]>(response);
}
