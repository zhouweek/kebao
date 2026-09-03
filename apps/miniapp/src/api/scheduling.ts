import { request } from "./client";
import type {
  AttendanceStatus,
  Booking,
  CourseSession,
  CreateSessionInput,
  CreateSeriesInput,
  RescheduleSessionInput,
  RosterStudent,
  SessionStatus,
  TeacherOptions,
  SeriesResult,
} from "./types";

interface DataResponse<T> {
  data: T;
}

export interface SessionFilters {
  from?: string;
  to?: string;
  teacherId?: string;
  campusId?: string;
  status?: SessionStatus;
}

function toQuery(filters: SessionFilters): string {
  const pairs = Object.entries(filters).filter((entry) => entry[1] !== undefined);
  if (pairs.length === 0) return "";
  return `?${pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&")}`;
}

export async function listSessions(
  filters: SessionFilters = {},
): Promise<CourseSession[]> {
  const response = await request<DataResponse<CourseSession[]>>(
    `/sessions${toQuery(filters)}`,
  );
  return response.data;
}

export async function getTeacherOptions(): Promise<TeacherOptions> {
  const response = await request<DataResponse<TeacherOptions>>("/teacher/options");
  return response.data;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<CourseSession> {
  const response = await request<DataResponse<CourseSession>>("/sessions", {
    method: "POST",
    data: input,
  });
  return response.data;
}

export async function previewSeries(input: CreateSeriesInput): Promise<SeriesResult> {
  const response = await request<DataResponse<SeriesResult>>("/session-series/preflight", {
    method: "POST",
    data: input,
  });
  return response.data;
}

export async function createSeries(input: CreateSeriesInput): Promise<SeriesResult> {
  const response = await request<DataResponse<SeriesResult>>("/session-series", {
    method: "POST",
    data: input,
  });
  return response.data;
}

export async function bookSession(
  sessionId: string,
  studentId: string,
): Promise<{ booking: Booking; alreadyBooked: boolean }> {
  const response = await request<
    DataResponse<{ booking: Booking; alreadyBooked: boolean }>
  >(`/sessions/${encodeURIComponent(sessionId)}/bookings`, {
    method: "POST",
    data: { studentId },
  });
  return response.data;
}

export async function cancelBooking(bookingId: string): Promise<Booking> {
  const response = await request<DataResponse<Booking>>(
    `/bookings/${encodeURIComponent(bookingId)}`,
    { method: "DELETE" },
  );
  return response.data;
}

export async function getRoster(sessionId: string): Promise<RosterStudent[]> {
  const response = await request<DataResponse<RosterStudent[]>>(
    `/teacher/sessions/${encodeURIComponent(sessionId)}/roster`,
  );
  return response.data;
}

export async function rescheduleSession(
  sessionId: string,
  input: RescheduleSessionInput,
): Promise<CourseSession | { sessions: CourseSession[] }> {
  const response = await request<DataResponse<CourseSession | { sessions: CourseSession[] }>>(
    `/sessions/${encodeURIComponent(sessionId)}/reschedule`,
    { method: "PATCH", data: input },
  );
  return response.data;
}

export async function cancelSession(
  sessionId: string,
  reason?: string,
): Promise<CourseSession> {
  const response = await request<DataResponse<CourseSession>>(
    `/sessions/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: "POST",
      data: reason ? { reason } : {},
    },
  );
  return response.data;
}

export async function markAttendance(
  sessionId: string,
  records: Array<{ bookingId: string; status: AttendanceStatus }>,
): Promise<Booking[]> {
  const response = await request<DataResponse<Booking[]>>(
    `/sessions/${encodeURIComponent(sessionId)}/attendance`,
    { method: "PUT", data: { records } },
  );
  return response.data;
}
