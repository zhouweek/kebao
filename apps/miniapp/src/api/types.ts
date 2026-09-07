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

export interface GuardianStudent {
  id: string;
  name: string;
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
  scope?: "THIS" | "THIS_AND_FUTURE";
}

export interface TeacherOption {
  id: string;
  name: string;
}

export interface CourseOption extends TeacherOption {
  durationMinutes?: number;
}

export interface CampusOption extends TeacherOption {}

export interface ClassroomOption extends TeacherOption {
  campusId: string;
  capacity?: number;
}

export interface TeacherOptions {
  teacher: TeacherOption;
  courses: CourseOption[];
  campuses: CampusOption[];
  classrooms: ClassroomOption[];
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
  skipConflicts: boolean;
}

export interface SeriesResult {
  sessions: CourseSession[];
  successDates: string[];
  conflicts: Array<{ date: string }>;
}

export type NotificationType =
  | "SESSION_RESCHEDULED"
  | "SESSION_CANCELLED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "SESSION_REMINDER_24H"
  | "SESSION_REMINDER_2H";

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
