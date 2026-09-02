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

export interface Booking {
  id: string;
  sessionId: string;
  studentId: string;
  status:
    | "CONFIRMED"
    | "CANCELLED"
    | "COURSE_CANCELLED"
    | "ATTENDED"
    | "LEAVE"
    | "ABSENT";
  createdAt: string;
}

export interface RosterStudent {
  id: string;
  name: string;
  guardianPhone: string;
  bookingId: string;
  bookingStatus: Booking["status"];
}

export type AttendanceStatus = "ATTENDED" | "LEAVE" | "ABSENT";

export interface RescheduleSessionInput {
  startsAt: string;
  endsAt: string;
  teacherId?: string;
  teacherName?: string;
  classroomId?: string | null;
  classroomName?: string | null;
}

export type NotificationType = "SESSION_RESCHEDULED" | "SESSION_CANCELLED";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content: string;
  sessionId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}
