import type { CourseSession, SessionStatus } from "../api/types";

const STATUS_LABELS: Record<SessionStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "可预约",
  CLOSED: "已停招",
  CANCELLED: "已停课",
  FINISHED: "已结束",
};

export function formatSessionTime(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = `${start.getMonth() + 1}月${start.getDate()}日`;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date} ${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(
    end.getHours(),
  )}:${pad(end.getMinutes())}`;
}

export function getSessionStatusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status];
}

export function getBookingAvailability(
  session: CourseSession,
  now = new Date(),
): { enabled: boolean; label: string } {
  if (session.status !== "PUBLISHED") {
    return { enabled: false, label: getSessionStatusLabel(session.status) };
  }
  if (session.remainingCapacity <= 0) {
    return { enabled: false, label: "已满" };
  }
  if (now < new Date(session.bookingOpensAt)) {
    return { enabled: false, label: "预约未开放" };
  }
  if (now >= new Date(session.bookingClosesAt)) {
    return { enabled: false, label: "预约已截止" };
  }
  return { enabled: true, label: `余 ${session.remainingCapacity} 位` };
}

export function canCancelBooking(cancelDeadlineAt: string, now = new Date()): boolean {
  return now < new Date(cancelDeadlineAt);
}
