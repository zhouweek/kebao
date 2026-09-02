import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  AttendanceStatus,
  AuditLog,
  CourseSession,
  CreateSessionInput,
  Notification,
  RosterStudent,
  SessionStatus,
  cancelSession,
  createSession,
  getAuditLogs,
  getNotifications,
  getRoster,
  getSessions,
  markNotificationRead,
  rescheduleSession,
  updateAttendance,
} from "./api";

type View = "overview" | "sessions" | "notifications" | "audit";
type Operation = "reschedule" | "cancel" | "attendance";

interface Option {
  id: string;
  name: string;
}

interface FormState {
  course: string;
  campus: string;
  teacher: string;
  classroom: string;
  date: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
  status: SessionStatus;
}

interface RescheduleFormState {
  date: string;
  startsAt: string;
  endsAt: string;
  teacher: string;
  classroom: string;
}

const courses: Option[] = [
  { id: "course-coding-l2", name: "少儿编程 L2" },
  { id: "course-art", name: "创意美术" },
  { id: "course-math", name: "思维数学" },
];
const campuses: Option[] = [
  { id: "campus-a", name: "A 校区" },
  { id: "campus-b", name: "B 校区" },
];
const teachers: Option[] = [
  { id: "teacher-1", name: "王老师" },
  { id: "teacher-2", name: "李老师" },
  { id: "teacher-3", name: "陈老师" },
];
const classrooms: Option[] = [
  { id: "room-105", name: "105 教室" },
  { id: "room-201", name: "201 教室" },
  { id: "room-302", name: "302 教室" },
];

const statusLabel: Record<SessionStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  CLOSED: "已停招",
  CANCELLED: "已取消",
  FINISHED: "已结束",
};

const attendanceLabel: Record<AttendanceStatus, string> = {
  ATTENDED: "已到",
  LEAVE: "请假",
  ABSENT: "缺席",
};

const auditActionLabel: Record<string, string> = {
  SESSION_CREATED: "创建课次",
  SESSION_RESCHEDULED: "调整课次",
  SESSION_CANCELLED: "停课",
  ATTENDANCE_UPDATED: "更新签到",
  NOTIFICATION_READ: "读取通知",
  BOOKING_CREATED: "创建预约",
  BOOKING_CANCELLED: "取消预约",
};

function toDateInput(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function initialForm(): FormState {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    course: courses[0]!.id,
    campus: campuses[0]!.id,
    teacher: teachers[0]!.id,
    classroom: classrooms[0]!.id,
    date: toDateInput(tomorrow),
    startsAt: "10:00",
    endsAt: "11:30",
    capacity: "12",
    status: "PUBLISHED",
  };
}

function Icon({
  children,
  size = 20,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function dateText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

function timeText(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function App() {
  const [view, setView] = useState<View>("overview");
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [selectedSession, setSelectedSession] = useState<CourseSession | null>(null);
  const [operationError, setOperationError] = useState("");
  const [operationSubmitting, setOperationSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [rescheduleForm, setRescheduleForm] = useState<RescheduleFormState | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});

  const loadSessions = async () => {
    setLoading(true);
    setLoadError("");
    try {
      setSessions(await getSessions());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "课次加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const loadNotifications = async () => {
    setLoading(true);
    setLoadError("");
    try {
      setNotifications(await getNotifications());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "通知加载失败");
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setLoading(true);
    setLoadError("");
    try {
      setAuditLogs(await getAuditLogs());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "审计日志加载失败");
    } finally {
      setLoading(false);
    }
  };

  const changeView = (next: View) => {
    setView(next);
    if (next === "notifications") void loadNotifications();
    if (next === "audit") void loadAuditLogs();
  };

  const notifySuccess = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(""), 3000);
  };

  const openOperation = async (kind: Operation, session: CourseSession) => {
    setSelectedSession(session);
    setOperation(kind);
    setOperationError("");
    setReason("");
    const start = new Date(session.startsAt);
    setRescheduleForm({
      date: toDateInput(start),
      startsAt: timeText(session.startsAt),
      endsAt: timeText(session.endsAt),
      teacher: session.teacherId,
      classroom: session.classroomId ?? classrooms[0]!.id,
    });
    if (kind === "attendance") {
      setOperationSubmitting(true);
      try {
        const result = await getRoster(session.id);
        setRoster(result);
        setAttendance(Object.fromEntries(result.map((student) => [
          student.bookingId,
          ["ATTENDED", "LEAVE", "ABSENT"].includes(student.bookingStatus)
            ? student.bookingStatus as AttendanceStatus
            : "ATTENDED",
        ])));
      } catch (error) {
        setOperationError(error instanceof Error ? error.message : "学员名单加载失败");
      } finally {
        setOperationSubmitting(false);
      }
    }
  };

  const closeOperation = () => {
    if (!operationSubmitting) {
      setOperation(null);
      setSelectedSession(null);
      setRoster([]);
    }
  };

  const submitOperation = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSession || !operation) return;
    setOperationSubmitting(true);
    setOperationError("");
    try {
      if (operation === "cancel") {
        await cancelSession(selectedSession.id, reason.trim());
        notifySuccess("停课成功，相关预约已同步处理");
      } else if (operation === "reschedule" && rescheduleForm) {
        const teacher = teachers.find((item) => item.id === rescheduleForm.teacher)!;
        const classroom = classrooms.find((item) => item.id === rescheduleForm.classroom)!;
        await rescheduleSession(selectedSession.id, {
          startsAt: new Date(`${rescheduleForm.date}T${rescheduleForm.startsAt}`).toISOString(),
          endsAt: new Date(`${rescheduleForm.date}T${rescheduleForm.endsAt}`).toISOString(),
          teacherId: teacher.id,
          teacherName: teacher.name,
          classroomId: classroom.id,
          classroomName: classroom.name,
        });
        notifySuccess("调课成功，家长将收到通知");
      } else if (operation === "attendance") {
        await updateAttendance(selectedSession.id, roster.map((student) => ({
          bookingId: student.bookingId,
          status: attendance[student.bookingId] ?? "ATTENDED",
        })));
        notifySuccess("签到状态已保存");
      }
      await loadSessions();
      setOperation(null);
      setSelectedSession(null);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "操作失败，请稍后重试");
    } finally {
      setOperationSubmitting(false);
    }
  };

  const readNotification = async (item: Notification) => {
    if (item.readAt) return;
    try {
      const updated = await markNotificationRead(item.id);
      setNotifications((current) =>
        current.map((notice) => notice.id === updated.id ? updated : notice),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "标记已读失败");
    }
  };

  const metrics = useMemo(() => {
    const now = new Date();
    const today = toDateInput(now);
    const active = sessions.filter((item) =>
      ["PUBLISHED", "CLOSED"].includes(item.status),
    );
    return {
      today: active.filter((item) => toDateInput(new Date(item.startsAt)) === today)
        .length,
      upcoming: active.filter((item) => new Date(item.startsAt) > now).length,
      booked: active.reduce((sum, item) => sum + item.bookedCount, 0),
      capacity: active.reduce((sum, item) => sum + item.capacity, 0),
    };
  }, [sessions]);

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSubmitError(null);
  };

  const openCreate = () => {
    setForm(initialForm());
    setSubmitError(null);
    setDialogOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    const course = courses.find((item) => item.id === form.course)!;
    const campus = campuses.find((item) => item.id === form.campus)!;
    const teacher = teachers.find((item) => item.id === form.teacher)!;
    const classroom = classrooms.find((item) => item.id === form.classroom)!;
    const input: CreateSessionInput = {
      courseId: course.id,
      courseName: course.name,
      campusId: campus.id,
      campusName: campus.name,
      classroomId: classroom.id,
      classroomName: classroom.name,
      teacherId: teacher.id,
      teacherName: teacher.name,
      startsAt: new Date(`${form.date}T${form.startsAt}`).toISOString(),
      endsAt: new Date(`${form.date}T${form.endsAt}`).toISOString(),
      capacity: Number(form.capacity),
      status: form.status,
    };
    setSubmitting(true);
    try {
      await createSession(input);
      await loadSessions();
      setDialogOpen(false);
      setView("sessions");
      setSuccess("课次创建成功");
      window.setTimeout(() => setSuccess(""), 3000);
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error
          : new ApiError("创建失败，请稍后重试", "UNKNOWN_ERROR", 0),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const upcoming = [...sessions]
    .filter((item) => new Date(item.endsAt) > new Date())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">课</span>
          <span>课宝</span>
        </div>
        <nav aria-label="主导航">
          <button
            className={view === "overview" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("overview")}
          >
            <Icon>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </Icon>
            概览
          </button>
          <button
            className={view === "sessions" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("sessions")}
          >
            <Icon>
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18" />
            </Icon>
            课次管理
          </button>
          <button
            className={view === "notifications" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("notifications")}
          >
            <Icon><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></Icon>
            站内通知
            {notifications.some((item) => !item.readAt) && <span className="nav-dot" />}
          </button>
          <button
            className={view === "audit" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("audit")}
          >
            <Icon><path d="M9 11h6M9 15h6M9 7h2M5 3h14v18H5z" /></Icon>
            审计日志
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">林</span>
          <span><b>林校长</b><small>超级管理员</small></span>
          <span className="more">•••</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">教学运营中心</p>
            <h1>{view === "overview" ? "上午好，林校长" : view === "sessions" ? "课次管理" : view === "notifications" ? "站内通知" : "审计日志"}</h1>
          </div>
          {(view === "overview" || view === "sessions") && <button className="primary-button" onClick={openCreate}>
            <Icon size={18}><path d="M12 5v14M5 12h14" /></Icon>
            创建课次
          </button>}
        </header>

        {success && <div className="toast" role="status">{success}</div>}
        {loadError && (
          <div className="load-error" role="alert">
            <span>{loadError}</span>
            <button onClick={() => void loadSessions()}>重新加载</button>
          </div>
        )}

        {view === "overview" ? (
          <section>
            <div className="intro-row">
              <p>这里是今天的校区运营概况。</p>
              <span>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date())}</span>
            </div>
            <div className="metric-grid">
              <article className="metric-card accent">
                <span className="metric-icon"><Icon><path d="M8 2v4M16 2v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /></Icon></span>
                <p>今日课次</p><strong>{metrics.today}</strong><small>节课程待进行</small>
              </article>
              <article className="metric-card">
                <span className="metric-icon green"><Icon><circle cx="12" cy="12" r="9" /><path d="m9 12 2 2 4-5" /></Icon></span>
                <p>待上课</p><strong>{metrics.upcoming}</strong><small>节已发布课次</small>
              </article>
              <article className="metric-card">
                <span className="metric-icon yellow"><Icon><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Icon></span>
                <p>已约人次</p><strong>{metrics.booked}</strong><small>当前有效预约</small>
              </article>
              <article className="metric-card">
                <span className="metric-icon blue"><Icon><path d="M3 3v18h18M7 16l4-5 3 3 5-7" /></Icon></span>
                <p>平均满班率</p><strong>{metrics.capacity ? Math.round(metrics.booked / metrics.capacity * 100) : 0}<i>%</i></strong><small>已发布课次</small>
              </article>
            </div>
            <div className="section-heading">
              <div><h2>近期课次</h2><p>按开课时间排序，快速掌握教学安排</p></div>
              <button className="text-button" onClick={() => changeView("sessions")}>查看全部 <span>→</span></button>
            </div>
            <SessionTable sessions={upcoming.slice(0, 5)} loading={loading} />
          </section>
        ) : view === "sessions" ? (
          <section>
            <div className="intro-row">
              <p>统一查看和安排各校区课程。</p>
              <span>共 {sessions.length} 个课次</span>
            </div>
            <div className="section-heading compact">
              <div><h2>全部课次</h2><p>列表数据来自排课服务</p></div>
              <button className="secondary-button" onClick={() => void loadSessions()}>
                <Icon size={17}><path d="M20 6v5h-5M4 18v-5h5M18.5 9a7 7 0 0 0-12-2L4 11M5.5 15a7 7 0 0 0 12 2l2.5-4" /></Icon>
                刷新
              </button>
            </div>
            <SessionTable sessions={sessions} loading={loading} onOperation={openOperation} />
          </section>
        ) : view === "notifications" ? (
          <NotificationsView
            notifications={notifications}
            loading={loading}
            onRead={readNotification}
            onRefresh={loadNotifications}
          />
        ) : (
          <AuditView logs={auditLogs} loading={loading} onRefresh={loadAuditLogs} />
        )}
      </main>

      {dialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !submitting) setDialogOpen(false);
        }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div className="dialog-header">
              <div><p className="eyebrow">新建教学安排</p><h2 id="dialog-title">创建课次</h2></div>
              <button className="icon-button" aria-label="关闭" disabled={submitting} onClick={() => setDialogOpen(false)}>×</button>
            </div>
            <form onSubmit={(event) => void submit(event)}>
              {submitError && <ConflictAlert error={submitError} sessions={sessions} />}
              <div className="form-grid">
                <Field label="课程"><Select value={form.course} options={courses} onChange={(value) => updateForm("course", value)} /></Field>
                <Field label="校区"><Select value={form.campus} options={campuses} onChange={(value) => updateForm("campus", value)} /></Field>
                <Field label="授课老师"><Select value={form.teacher} options={teachers} onChange={(value) => updateForm("teacher", value)} /></Field>
                <Field label="教室"><Select value={form.classroom} options={classrooms} onChange={(value) => updateForm("classroom", value)} /></Field>
                <Field label="上课日期"><input required type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} /></Field>
                <Field label="课次状态">
                  <select value={form.status} onChange={(event) => updateForm("status", event.target.value as SessionStatus)}>
                    <option value="PUBLISHED">已发布</option><option value="DRAFT">草稿</option>
                  </select>
                </Field>
                <Field label="开始时间"><input required type="time" value={form.startsAt} onChange={(event) => updateForm("startsAt", event.target.value)} /></Field>
                <Field label="结束时间"><input required type="time" value={form.endsAt} onChange={(event) => updateForm("endsAt", event.target.value)} /></Field>
                <Field label="课次容量" wide><div className="capacity-input"><input required min="1" step="1" type="number" value={form.capacity} onChange={(event) => updateForm("capacity", event.target.value)} /><span>人</span></div></Field>
              </div>
              <div className="form-note"><Icon size={17}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Icon>发布课次时，系统会自动检查老师和教室的时间冲突。</div>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" disabled={submitting} onClick={() => setDialogOpen(false)}>取消</button>
                <button type="submit" className="primary-button" disabled={submitting}>{submitting ? "正在创建…" : "确认创建"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {operation && selectedSession && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeOperation();
        }}>
          <section className="dialog operation-dialog" role="dialog" aria-modal="true" aria-labelledby="operation-title">
            <div className="dialog-header">
              <div>
                <p className="eyebrow">{selectedSession.courseName}</p>
                <h2 id="operation-title">
                  {operation === "reschedule" ? "调整课次" : operation === "cancel" ? "确认停课" : "学员签到"}
                </h2>
              </div>
              <button className="icon-button" aria-label="关闭" disabled={operationSubmitting} onClick={closeOperation}>×</button>
            </div>
            <form onSubmit={(event) => void submitOperation(event)}>
              {operationError && <div className="conflict-alert" role="alert"><span className="alert-icon">!</span><div><strong>操作未完成</strong><p>{operationError}</p></div></div>}
              {operation === "reschedule" && rescheduleForm && (
                <>
                  <div className="form-grid">
                    <Field label="上课日期"><input required type="date" value={rescheduleForm.date} onChange={(event) => setRescheduleForm({ ...rescheduleForm, date: event.target.value })} /></Field>
                    <Field label="授课老师"><Select value={rescheduleForm.teacher} options={teachers} onChange={(teacher) => setRescheduleForm({ ...rescheduleForm, teacher })} /></Field>
                    <Field label="开始时间"><input required type="time" value={rescheduleForm.startsAt} onChange={(event) => setRescheduleForm({ ...rescheduleForm, startsAt: event.target.value })} /></Field>
                    <Field label="结束时间"><input required type="time" value={rescheduleForm.endsAt} onChange={(event) => setRescheduleForm({ ...rescheduleForm, endsAt: event.target.value })} /></Field>
                    <Field label="教室" wide><Select value={rescheduleForm.classroom} options={classrooms} onChange={(classroom) => setRescheduleForm({ ...rescheduleForm, classroom })} /></Field>
                  </div>
                  <div className="form-note">调课后系统会重新校验时间冲突，并向相关家长发送站内通知。</div>
                </>
              )}
              {operation === "cancel" && (
                <>
                  <div className="danger-summary">
                    <strong>确定停掉这节课吗？</strong>
                    <p>{dateText(selectedSession.startsAt)} {timeText(selectedSession.startsAt)}–{timeText(selectedSession.endsAt)}，已有 {selectedSession.bookedCount} 人预约。</p>
                  </div>
                  <Field label="停课原因">
                    <textarea required maxLength={500} rows={4} placeholder="请填写停课原因，原因将随通知发送给家长" value={reason} onChange={(event) => setReason(event.target.value)} />
                  </Field>
                </>
              )}
              {operation === "attendance" && (
                <div className="roster-list">
                  {operationSubmitting && roster.length === 0 ? <div className="table-state small">正在加载学员名单…</div> :
                    roster.length === 0 ? <div className="table-state small">当前课次暂无有效预约</div> :
                    roster.map((student) => (
                      <div className="roster-row" key={student.bookingId}>
                        <span className="student-avatar">{student.name.slice(-1)}</span>
                        <span><b>{student.name}</b><small>{student.guardianPhone}</small></span>
                        <select aria-label={`${student.name}签到状态`} value={attendance[student.bookingId] ?? "ATTENDED"} onChange={(event) => setAttendance((current) => ({ ...current, [student.bookingId]: event.target.value as AttendanceStatus }))}>
                          {Object.entries(attendanceLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                    ))}
                </div>
              )}
              <div className="dialog-actions">
                <button type="button" className="secondary-button" disabled={operationSubmitting} onClick={closeOperation}>取消</button>
                <button type="submit" className={operation === "cancel" ? "danger-button" : "primary-button"} disabled={operationSubmitting || (operation === "attendance" && roster.length === 0)}>
                  {operationSubmitting ? "正在提交…" : operation === "cancel" ? "确认停课" : operation === "reschedule" ? "确认调整" : "保存签到"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}</label>;
}

function Select({ value, options, onChange }: { value: string; options: Option[]; onChange: (value: string) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>;
}

function ConflictAlert({ error, sessions }: { error: ApiError; sessions: CourseSession[] }) {
  const conflicts = error.details?.conflicts ?? [];
  return (
    <div className="conflict-alert" role="alert">
      <span className="alert-icon">!</span>
      <div>
        <strong>{error.code === "SESSION_CONFLICT" ? "排课时间有冲突" : "无法创建课次"}</strong>
        <p>{error.message}</p>
        {conflicts.map((conflict) => {
          const item = sessions.find((session) => session.id === conflict.sessionId);
          return <p className="conflict-detail" key={conflict.sessionId}>
            {conflict.teacherConflict && "老师冲突"}
            {conflict.teacherConflict && conflict.classroomConflict && "、"}
            {conflict.classroomConflict && "教室冲突"}
            {item && `：${item.courseName}（${dateText(item.startsAt)} ${timeText(item.startsAt)}–${timeText(item.endsAt)}）`}
          </p>;
        })}
      </div>
    </div>
  );
}

function SessionTable({ sessions, loading, onOperation }: { sessions: CourseSession[]; loading: boolean; onOperation?: (operation: Operation, session: CourseSession) => void }) {
  if (loading) return <div className="table-state">正在加载课次…</div>;
  if (sessions.length === 0) return <div className="table-state"><strong>还没有课次</strong><span>点击「创建课次」安排第一节课程</span></div>;
  return (
    <div className="table-card">
      <table>
        <thead><tr><th>课程</th><th>上课时间</th><th>老师 / 教室</th><th>预约情况</th><th>状态</th>{onOperation && <th>操作</th>}</tr></thead>
        <tbody>
          {sessions.map((item) => (
            <tr key={item.id}>
              <td><span className="course-cell"><i>{item.courseName.slice(0, 1)}</i><span><b>{item.courseName}</b><small>{item.campusName}</small></span></span></td>
              <td><b>{dateText(item.startsAt)}</b><small>{timeText(item.startsAt)}–{timeText(item.endsAt)}</small></td>
              <td><b>{item.teacherName}</b><small>{item.classroomName ?? "未安排教室"}</small></td>
              <td><b>{item.bookedCount}<em> / {item.capacity} 人</em></b><span className="progress"><i style={{ width: `${Math.min(100, item.bookedCount / item.capacity * 100)}%` }} /></span></td>
              <td><span className={`status status-${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span></td>
              {onOperation && <td><div className="row-actions">
                <button disabled={item.status === "CANCELLED" || item.status === "FINISHED"} onClick={() => onOperation("reschedule", item)}>调课</button>
                <button disabled={item.status === "CANCELLED" || item.status === "FINISHED"} onClick={() => onOperation("attendance", item)}>签到</button>
                <button className="danger-link" disabled={item.status === "CANCELLED" || item.status === "FINISHED"} onClick={() => onOperation("cancel", item)}>停课</button>
              </div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotificationsView({ notifications, loading, onRead, onRefresh }: { notifications: Notification[]; loading: boolean; onRead: (item: Notification) => void; onRefresh: () => void }) {
  return <section>
    <div className="intro-row"><p>查看调课、停课等运营消息。</p><span>{notifications.filter((item) => !item.readAt).length} 条未读</span></div>
    <div className="section-heading compact"><div><h2>全部通知</h2><p>点击未读通知即可标记为已读</p></div><button className="secondary-button" onClick={onRefresh}>刷新</button></div>
    {loading ? <div className="table-state">正在加载通知…</div> : notifications.length === 0 ? <div className="table-state"><strong>暂无通知</strong><span>调课和停课消息会显示在这里</span></div> :
      <div className="notice-list">{notifications.map((item) => <button key={item.id} className={item.readAt ? "notice-item" : "notice-item unread"} onClick={() => void onRead(item)}>
        <span className="notice-icon">{item.type === "SESSION_CANCELLED" ? "停" : "调"}</span>
        <span className="notice-body"><span><b>{item.title}</b>{!item.readAt && <i>未读</i>}</span><p>{item.content}</p><small>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</small></span>
      </button>)}</div>}
  </section>;
}

function AuditView({ logs, loading, onRefresh }: { logs: AuditLog[]; loading: boolean; onRefresh: () => void }) {
  return <section>
    <div className="intro-row"><p>追踪管理员在系统中的关键操作。</p><span>共 {logs.length} 条记录</span></div>
    <div className="section-heading compact"><div><h2>操作记录</h2><p>审计日志仅管理员可见</p></div><button className="secondary-button" onClick={onRefresh}>刷新</button></div>
    {loading ? <div className="table-state">正在加载审计日志…</div> : logs.length === 0 ? <div className="table-state"><strong>暂无审计记录</strong></div> :
      <div className="table-card"><table><thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>对象</th><th>详情</th></tr></thead><tbody>
        {logs.map((log) => <tr key={log.id}><td><b>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(log.createdAt))}</b></td><td><span className="audit-action">{auditActionLabel[log.action] ?? log.action}</span></td><td>{log.actorId}</td><td><b>{log.entityType}</b><small>{log.entityId}</small></td><td><code>{JSON.stringify(log.details)}</code></td></tr>)}
      </tbody></table></div>}
  </section>;
}

export default App;
