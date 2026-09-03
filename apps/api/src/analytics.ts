import {
  type AuditLog,
  type Booking,
  type BookingStatus,
  type CourseSession,
  DomainError,
  type Repository,
} from "./domain.js";
import { maskPhone } from "./security.js";

export interface AnalyticsFilter {
  from?: Date;
  to?: Date;
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
  startsAt: Date;
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
  generatedAt: Date;
  definitions: typeof ANALYTICS_DEFINITIONS;
}

export const ANALYTICS_DEFINITIONS = {
  sessions: "课次数仅统计已发布、已停招、已结束课次，排除草稿和已取消（停课）课次。",
  reservations: "预约人次统计有效课次下除课程取消外的预约单，包含用户取消。",
  occupancy: "上座率 = 有效预约（已确认、已到、请假、缺席）÷ 有效课次总容量。",
  cancellation: "取消率 = 用户取消预约数 ÷ 预约人次。",
  attendance: "到课率 = 已到人数 ÷ 已记录考勤人数（已到、请假、缺席）。",
} as const;

const VALID_SESSION_STATUSES = new Set<CourseSession["status"]>([
  "PUBLISHED",
  "CLOSED",
  "FINISHED",
]);
const ACTIVE_BOOKING_STATUSES = new Set<BookingStatus>([
  "CONFIRMED",
  "ATTENDED",
  "LEAVE",
  "ABSENT",
]);
const ATTENDANCE_STATUSES = new Set<BookingStatus>(["ATTENDED", "LEAVE", "ABSENT"]);

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(",");
}

function statusLabel(status: BookingStatus): string {
  return {
    CONFIRMED: "已确认",
    CANCELLED: "已取消",
    COURSE_CANCELLED: "课程取消",
    ATTENDED: "已到",
    LEAVE: "请假",
    ABSENT: "缺席",
  }[status];
}

export class AnalyticsService {
  constructor(
    private readonly repository: Repository,
    private readonly organizationId: string,
    private readonly actorId: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async getStatistics(filter: AnalyticsFilter): Promise<AnalyticsResult> {
    this.validateFilter(filter);
    const sessions = (
      await this.repository.listSessions(this.organizationId, {
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
        ...(filter.campusId ? { campusId: filter.campusId } : {}),
        ...(filter.courseId ? { courseId: filter.courseId } : {}),
        ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
      })
    ).filter(
      (session) =>
        VALID_SESSION_STATUSES.has(session.status) &&
        (!filter.from || session.startsAt >= filter.from) &&
        (!filter.to || session.startsAt < filter.to),
    );
    const sessionIds = new Set(sessions.map((session) => session.id));
    const bookings = (await this.repository.listBookings(this.organizationId)).filter(
      (booking) => sessionIds.has(booking.sessionId),
    );
    const bySession = new Map<string, Booking[]>();
    for (const booking of bookings) {
      const items = bySession.get(booking.sessionId) ?? [];
      items.push(booking);
      bySession.set(booking.sessionId, items);
    }

    const details = sessions.map((session) =>
      this.detailFor(session, bySession.get(session.id) ?? []),
    );
    const reservationCount = details.reduce((sum, item) => sum + item.reservationCount, 0);
    const activeBookingCount = details.reduce(
      (sum, item) => sum + item.activeBookingCount,
      0,
    );
    const cancelledBookingCount = details.reduce(
      (sum, item) => sum + item.cancelledBookingCount,
      0,
    );
    const attendedCount = details.reduce((sum, item) => sum + item.attendedCount, 0);
    const attendanceRecorded = details.reduce(
      (sum, item) => sum + item.attendedCount + item.leaveCount + item.absentCount,
      0,
    );
    const capacity = details.reduce((sum, item) => sum + item.capacity, 0);

    return {
      metrics: {
        sessionCount: details.length,
        reservationCount,
        occupancyRate: percentage(activeBookingCount, capacity),
        cancellationRate: percentage(cancelledBookingCount, reservationCount),
        attendanceRate: percentage(attendedCount, attendanceRecorded),
      },
      details,
      generatedAt: this.now(),
      definitions: ANALYTICS_DEFINITIONS,
    };
  }

  async exportCsv(filter: AnalyticsFilter): Promise<{ csv: string; filename: string }> {
    const result = await this.getStatistics(filter);
    const bookings = await this.repository.listBookings(this.organizationId);
    const bookingsBySession = new Map<string, Booking[]>();
    for (const booking of bookings) {
      const items = bookingsBySession.get(booking.sessionId) ?? [];
      items.push(booking);
      bookingsBySession.set(booking.sessionId, items);
    }
    const rows: string[] = [
      csvRow(["统计明细导出"]),
      csvRow(["生成时间", result.generatedAt.toISOString()]),
      csvRow(["筛选条件", this.filterDescription(filter)]),
      ...Object.values(result.definitions).map((definition) => csvRow(["口径说明", definition])),
      "",
      csvRow([
        "课次ID",
        "开课时间",
        "校区",
        "课程",
        "老师",
        "容量",
        "预约单ID",
        "学生ID",
        "学生姓名",
        "家长手机号（脱敏）",
        "预约状态",
      ]),
    ];
    let exportedRows = 0;
    for (const detail of result.details) {
      const sessionBookings = (bookingsBySession.get(detail.sessionId) ?? []).filter(
        (booking) => booking.status !== "COURSE_CANCELLED",
      );
      if (sessionBookings.length === 0) {
        rows.push(
          csvRow([
            detail.sessionId,
            detail.startsAt.toISOString(),
            detail.campusName,
            detail.courseName,
            detail.teacherName,
            detail.capacity,
            "",
            "",
            "",
            "",
            "无预约",
          ]),
        );
        exportedRows += 1;
        continue;
      }
      for (const booking of sessionBookings) {
        const student = await this.repository.getStudent(
          this.organizationId,
          booking.studentId,
        );
        rows.push(
          csvRow([
            detail.sessionId,
            detail.startsAt.toISOString(),
            detail.campusName,
            detail.courseName,
            detail.teacherName,
            detail.capacity,
            booking.id,
            booking.studentId,
            student?.name ?? "未知学生",
            maskPhone(student?.guardianPhone ?? ""),
            statusLabel(booking.status),
          ]),
        );
        exportedRows += 1;
      }
    }

    const exportId = this.createId();
    const auditLog: AuditLog = {
      id: exportId,
      actorId: this.actorId,
      action: "STATISTICS_CSV_EXPORTED",
      entityType: "StatisticsExport",
      entityId: exportId,
      details: {
        filter: this.serializableFilter(filter),
        generatedAt: result.generatedAt.toISOString(),
        definitions: result.definitions,
        rowCount: exportedRows,
      },
      createdAt: result.generatedAt,
    };
    await this.repository.saveAuditLog(this.organizationId, auditLog);
    const stamp = result.generatedAt.toISOString().replaceAll(/[:.]/g, "-");
    return {
      csv: `\uFEFF${rows.join("\r\n")}\r\n`,
      filename: `statistics-details-${stamp}.csv`,
    };
  }

  private detailFor(session: CourseSession, bookings: Booking[]): AnalyticsDetail {
    const included = bookings.filter((booking) => booking.status !== "COURSE_CANCELLED");
    const active = included.filter((booking) =>
      ACTIVE_BOOKING_STATUSES.has(booking.status),
    ).length;
    const cancelled = included.filter((booking) => booking.status === "CANCELLED").length;
    const attended = included.filter((booking) => booking.status === "ATTENDED").length;
    const leave = included.filter((booking) => booking.status === "LEAVE").length;
    const absent = included.filter((booking) => booking.status === "ABSENT").length;
    const attendanceRecorded = included.filter((booking) =>
      ATTENDANCE_STATUSES.has(booking.status),
    ).length;
    return {
      sessionId: session.id,
      startsAt: session.startsAt,
      courseId: session.courseId,
      courseName: session.courseName,
      campusId: session.campusId,
      campusName: session.campusName,
      teacherId: session.teacherId,
      teacherName: session.teacherName,
      capacity: session.capacity,
      reservationCount: included.length,
      activeBookingCount: active,
      cancelledBookingCount: cancelled,
      attendedCount: attended,
      leaveCount: leave,
      absentCount: absent,
      occupancyRate: percentage(active, session.capacity),
      cancellationRate: percentage(cancelled, included.length),
      attendanceRate: percentage(attended, attendanceRecorded),
    };
  }

  private validateFilter(filter: AnalyticsFilter): void {
    if (filter.from && filter.to && filter.from >= filter.to) {
      throw new DomainError("INVALID_TIME_RANGE", "to 必须晚于 from", 400);
    }
  }

  private serializableFilter(filter: AnalyticsFilter) {
    return {
      from: filter.from?.toISOString() ?? null,
      to: filter.to?.toISOString() ?? null,
      campusId: filter.campusId ?? null,
      courseId: filter.courseId ?? null,
      teacherId: filter.teacherId ?? null,
    };
  }

  private filterDescription(filter: AnalyticsFilter): string {
    const values = this.serializableFilter(filter);
    return Object.entries(values)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ") || "全部";
  }
}
