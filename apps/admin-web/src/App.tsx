import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  AttendanceStatus,
  AuditLog,
  CourseSession,
  CreateSessionInput,
  CreateSeriesInput,
  Notification,
  NotificationDelivery,
  RosterStudent,
  SessionStatus,
  MasterDataItem,
  MasterResource,
  cancelSession,
  changeAdminPassword,
  clearAuth,
  createSession,
  createSeries,
  previewSeries,
  getAuditLogs,
  getNotifications,
  getNotificationDeliveries,
  getRoster,
  getSessions,
  getMasterData,
  getMe,
  getStoredAuth,
  hasAuth,
  isDevelopmentIdentityEnabled,
  loginAdmin,
  logout,
  markNotificationRead,
  rescheduleSession,
  resendNotificationDelivery,
  updateAttendance,
} from "./api";
import { MasterDataView } from "./MasterDataView";
import { BookingManagementView } from "./BookingManagementView";
import { AnalyticsView } from "./AnalyticsView";

type View =
  | "overview"
  | "sessions"
  | "bookings"
  | "analytics"
  | "notifications"
  | "deliveries"
  | "audit"
  | MasterResource;
type Operation = "reschedule" | "cancel" | "attendance";

const LOGIN_CREDENTIALS_STORAGE_KEY = "kebao.admin.login-credentials";

interface LoginCredentials {
  organizationCode: string;
  phone: string;
  password: string;
}

function storedLoginCredentials(): LoginCredentials | undefined {
  try {
    const value = localStorage.getItem(LOGIN_CREDENTIALS_STORAGE_KEY);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as Partial<LoginCredentials>;
    if (
      typeof parsed.organizationCode !== "string" ||
      typeof parsed.phone !== "string" ||
      typeof parsed.password !== "string"
    ) {
      return undefined;
    }
    return {
      organizationCode: parsed.organizationCode,
      phone: parsed.phone,
      password: parsed.password,
    };
  } catch {
    return undefined;
  }
}

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
  repeatMode: "ONCE" | "WEEKLY";
  repeatCount: string;
  skipConflicts: boolean;
}

interface RescheduleFormState {
  date: string;
  startsAt: string;
  endsAt: string;
  teacher: string;
  classroom: string;
}

const masterLabels: Record<MasterResource, string> = {
  campuses: "校区管理",
  classrooms: "教室管理",
  courses: "课程管理",
  teachers: "老师管理",
  guardians: "家长管理",
  students: "学生管理",
};

const masterResources = Object.keys(masterLabels) as MasterResource[];

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
  ADMIN_BOOKING_CREATED: "管理员代预约",
  ADMIN_BOOKING_CANCELLED: "管理员代取消",
};

function toDateInput(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function initialForm(): FormState {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    course: "",
    campus: "",
    teacher: "",
    classroom: "",
    date: toDateInput(tomorrow),
    startsAt: "10:00",
    endsAt: "11:30",
    capacity: "12",
    status: "PUBLISHED",
    repeatMode: "ONCE",
    repeatCount: "4",
    skipConflicts: false,
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
  const rememberedLogin = useMemo(() => storedLoginCredentials(), []);
  const [authenticated, setAuthenticated] = useState(
    () => hasAuth() || isDevelopmentIdentityEnabled(),
  );
  const [authUser, setAuthUser] = useState(() => getStoredAuth()?.user);
  const [loginOrganizationCode, setLoginOrganizationCode] = useState(
    rememberedLogin?.organizationCode ?? "",
  );
  const [loginPhone, setLoginPhone] = useState(rememberedLogin?.phone ?? "");
  const [loginPassword, setLoginPassword] = useState(
    rememberedLogin?.password ?? "",
  );
  const [rememberLogin, setRememberLogin] = useState(Boolean(rememberedLogin));
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [selectedSession, setSelectedSession] = useState<CourseSession | null>(null);
  const [operationError, setOperationError] = useState("");
  const [operationSubmitting, setOperationSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [operationScope, setOperationScope] = useState<"THIS" | "THIS_AND_FUTURE">("THIS");
  const [rescheduleForm, setRescheduleForm] = useState<RescheduleFormState | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [masterLookups, setMasterLookups] = useState<Record<MasterResource, MasterDataItem[]>>({
    campuses: [],
    classrooms: [],
    courses: [],
    teachers: [],
    guardians: [],
    students: [],
  });
  const courses = masterLookups.courses;
  const campuses = masterLookups.campuses;
  const teachers = masterLookups.teachers;
  const classrooms = masterLookups.classrooms.filter(
    (item) => !form.campus || item.campusId === form.campus,
  );

  const clearRememberedLogin = () => {
    localStorage.removeItem(LOGIN_CREDENTIALS_STORAGE_KEY);
    setRememberLogin(false);
    setLoginPassword("");
  };

  const loadMasterLookups = async () => {
    const resources: MasterResource[] = [
      "campuses",
      "classrooms",
      "courses",
      "teachers",
      "guardians",
      "students",
    ];
    const results = await Promise.all(
      resources.map(async (resource) => [
        resource,
        (await getMasterData(resource, { pageSize: 100, activeOnly: true })).items,
      ] as const),
    );
    setMasterLookups((current) => ({ ...current, ...Object.fromEntries(results) }));
    return Object.fromEntries(results) as Partial<Record<MasterResource, MasterDataItem[]>>;
  };

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
    if (!authenticated) return;
    if (isDevelopmentIdentityEnabled() && !hasAuth()) {
      void loadSessions();
      return;
    }
    void getMe()
      .then((current) => {
        setAuthUser(current);
        if (current.mustChangePassword) {
          clearRememberedLogin();
        } else {
          void loadSessions();
        }
      })
      .catch((error) => {
        clearAuth();
        setAuthenticated(false);
        setLoginError(error instanceof Error ? error.message : "登录已失效，请重新登录");
      });
  }, [authenticated]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginSubmitting(true);
    setLoginError("");
    try {
      const result = await loginAdmin(
        loginOrganizationCode.trim(),
        loginPhone.trim(),
        loginPassword,
      );
      setAuthUser(result.user);
      if (result.user.mustChangePassword) {
        clearRememberedLogin();
      } else if (rememberLogin) {
        localStorage.setItem(
          LOGIN_CREDENTIALS_STORAGE_KEY,
          JSON.stringify({
            organizationCode: loginOrganizationCode.trim(),
            phone: loginPhone.trim(),
            password: loginPassword,
          } satisfies LoginCredentials),
        );
      } else {
        localStorage.removeItem(LOGIN_CREDENTIALS_STORAGE_KEY);
        setLoginOrganizationCode("");
        setLoginPhone("");
        setLoginPassword("");
      }
      setAuthenticated(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoginSubmitting(false);
    }
  };

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

  const loadDeliveries = async () => {
    setLoading(true);
    setLoadError("");
    try {
      setDeliveries(await getNotificationDeliveries());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "投递记录加载失败");
    } finally {
      setLoading(false);
    }
  };

  const changeView = (next: View) => {
    setView(next);
    if (next === "notifications") void loadNotifications();
    if (next === "deliveries") void loadDeliveries();
    if (next === "audit") void loadAuditLogs();
    if (next === "bookings") void loadMasterLookups();
    if (next === "analytics") void loadMasterLookups();
    if (masterResources.includes(next as MasterResource)) void loadMasterLookups();
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
    setOperationScope("THIS");
    const start = new Date(session.startsAt);
    setRescheduleForm({
      date: toDateInput(start),
      startsAt: timeText(session.startsAt),
      endsAt: timeText(session.endsAt),
      teacher: session.teacherId,
      classroom: session.classroomId ?? "",
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
        await cancelSession(selectedSession.id, reason.trim(), fetch, operationScope);
        notifySuccess("停课成功，相关预约已同步处理");
      } else if (operation === "reschedule" && rescheduleForm) {
        const teacher = teachers.find((item) => item.id === rescheduleForm.teacher);
        const classroom = masterLookups.classrooms.find((item) => item.id === rescheduleForm.classroom);
        if (!teacher || !classroom) throw new Error("请选择有效的老师和教室");
        await rescheduleSession(selectedSession.id, {
          startsAt: new Date(`${rescheduleForm.date}T${rescheduleForm.startsAt}`).toISOString(),
          endsAt: new Date(`${rescheduleForm.date}T${rescheduleForm.endsAt}`).toISOString(),
          teacherId: teacher.id,
          teacherName: teacher.name,
          classroomId: classroom.id,
          classroomName: classroom.name,
          scope: operationScope,
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

  const openCreate = async () => {
    setSubmitError(null);
    try {
      const lookups = await loadMasterLookups();
      const next = initialForm();
      next.course = lookups.courses?.[0]?.id ?? "";
      next.campus = lookups.campuses?.[0]?.id ?? "";
      next.teacher = lookups.teachers?.[0]?.id ?? "";
      next.classroom = lookups.classrooms?.find(
        (item) => item.campusId === next.campus,
      )?.id ?? "";
      setForm(next);
      setDialogOpen(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "排课基础资料加载失败");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    const course = courses.find((item) => item.id === form.course);
    const campus = campuses.find((item) => item.id === form.campus);
    const teacher = teachers.find((item) => item.id === form.teacher);
    const classroom = masterLookups.classrooms.find((item) => item.id === form.classroom);
    if (!course || !campus || !teacher || !classroom) {
      setSubmitError(new ApiError("请选择有效的课程、校区、老师和教室", "INVALID_MASTER_DATA", 400));
      return;
    }
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
      if (form.repeatMode === "WEEKLY") {
        const seriesInput: CreateSeriesInput = {
          ...input,
          recurrence: "WEEKLY",
          intervalWeeks: 1,
          repeatCount: Number(form.repeatCount),
          skipConflicts: form.skipConflicts,
        };
        const preview = await previewSeries(seriesInput);
        if (preview.conflicts.length && !form.skipConflicts) {
          throw new ApiError(
            "系列中存在冲突日期，默认不会创建任何课次",
            "SERIES_CONFLICT",
            409,
            { conflicts: preview.conflicts },
          );
        }
        const result = await createSeries(seriesInput);
        setSuccess(
          result.conflicts.length
            ? `已创建 ${result.sessions.length} 节，跳过 ${result.conflicts.length} 个冲突日期`
            : `系列创建成功，共 ${result.sessions.length} 节`,
        );
      } else {
        await createSession(input);
        setSuccess("课次创建成功");
      }
      await loadSessions();
      setDialogOpen(false);
      setView("sessions");
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

  if (!authenticated) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={(event) => void submitLogin(event)}>
          <p className="eyebrow">课宝教学运营中心</p>
          <h1>管理员登录</h1>
          {loginError && <div className="load-error" role="alert">{loginError}</div>}
          <Field label="机构编码">
            <input
              autoComplete="organization"
              required
              value={loginOrganizationCode}
              onChange={(event) => setLoginOrganizationCode(event.target.value)}
            />
          </Field>
          <Field label="手机号">
            <input
              autoComplete="username"
              inputMode="tel"
              required
              value={loginPhone}
              onChange={(event) => setLoginPhone(event.target.value)}
            />
          </Field>
          <Field label="密码">
            <div className="password-input">
              <input
                autoComplete="current-password"
                minLength={8}
                required
                type={passwordVisible ? "text" : "password"}
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
              <button
                type="button"
                className="password-visibility"
                aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((current) => !current)}
              >
                <Icon size={19}>
                  {passwordVisible ? (
                    <>
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.7 10.7 0 0 1 12 4c5 0 9 5 9 8a9.8 9.8 0 0 1-2 3.8M6.6 6.6C4.4 8 3 10.2 3 12c0 3 4 8 9 8 1.2 0 2.4-.3 3.4-.8" />
                    </>
                  ) : (
                    <>
                      <path d="M3 12c0-3 4-8 9-8s9 5 9 8-4 8-9 8-9-5-9-8Z" />
                      <circle cx="12" cy="12" r="2.5" />
                    </>
                  )}
                </Icon>
              </button>
            </div>
          </Field>
          <label className="remember-login">
            <input
              type="checkbox"
              checked={rememberLogin}
              onChange={(event) => {
                const checked = event.target.checked;
                setRememberLogin(checked);
                if (!checked) {
                  localStorage.removeItem(LOGIN_CREDENTIALS_STORAGE_KEY);
                }
              }}
            />
            <span>记住上次登录信息</span>
          </label>
          <button className="primary-button" disabled={loginSubmitting} type="submit">
            {loginSubmitting ? "正在登录…" : "登录"}
          </button>
        </form>
      </main>
    );
  }

  if (authUser?.mustChangePassword) {
    return <AdminForcePasswordChange
      name={authUser.name}
      onChanged={() => {
        setAuthUser(undefined);
        setAuthenticated(false);
      }}
      onLogout={() => {
        clearAuth();
        setAuthUser(undefined);
        setAuthenticated(false);
      }}
    />;
  }

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
            className={view === "bookings" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("bookings")}
          >
            <Icon>
              <path d="M4 7h16v13H4zM8 7V4h8v3M8 12h8M8 16h5" />
            </Icon>
            预约管理
          </button>
          <button
            className={view === "analytics" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("analytics")}
          >
            <Icon>
              <path d="M3 3v18h18M7 16l4-5 3 3 5-7" />
            </Icon>
            经营统计
          </button>
          {masterResources.map((resource) => (
            <button
              key={resource}
              className={view === resource ? "nav-item active" : "nav-item"}
              onClick={() => changeView(resource)}
            >
              <Icon><path d="M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4" /></Icon>
              {masterLabels[resource]}
            </button>
          ))}
          <button
            className={view === "notifications" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("notifications")}
          >
            <Icon><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></Icon>
            站内通知
            {notifications.some((item) => !item.readAt) && <span className="nav-dot" />}
          </button>
          <button
            className={view === "deliveries" ? "nav-item active" : "nav-item"}
            onClick={() => changeView("deliveries")}
          >
            <Icon><path d="M4 4h16v16H4zM4 8l8 5 8-5M8 17h8" /></Icon>
            通知投递
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
          <span className="avatar">{authUser?.name?.slice(-1) ?? "管"}</span>
          <span><b>{authUser?.name ?? "管理员"}</b><small>机构管理员</small></span>
          <div className="account-actions">
            <button
              className="more"
              aria-label="修改本人密码"
              onClick={() => setPasswordDialogOpen(true)}
            >
              改密
            </button>
            <button
              className="more"
              aria-label="退出登录"
              onClick={() => void logout().finally(() => setAuthenticated(false))}
            >
              退出
            </button>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">教学运营中心</p>
            <h1>{view === "overview" ? `上午好，${authUser?.name ?? "管理员"}` : view === "sessions" ? "课次管理" : view === "bookings" ? "预约管理" : view === "analytics" ? "经营统计" : view === "notifications" ? "站内通知" : view === "deliveries" ? "通知投递" : view === "audit" ? "审计日志" : masterLabels[view]}</h1>
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
        ) : view === "bookings" ? (
          <BookingManagementView
            sessions={sessions}
            students={masterLookups.students}
          />
        ) : view === "analytics" ? (
          <AnalyticsView
            campuses={masterLookups.campuses}
            courses={masterLookups.courses}
            teachers={masterLookups.teachers}
          />
        ) : masterResources.includes(view as MasterResource) ? (
          <MasterDataView
            resource={view as MasterResource}
            campuses={masterLookups.campuses}
            guardians={masterLookups.guardians}
            onChanged={async () => {
              await loadMasterLookups();
            }}
          />
        ) : view === "notifications" ? (
          <NotificationsView
            notifications={notifications}
            loading={loading}
            onRead={readNotification}
            onRefresh={loadNotifications}
          />
        ) : view === "deliveries" ? (
          <NotificationDeliveriesView
            deliveries={deliveries}
            loading={loading}
            onRefresh={loadDeliveries}
            onResend={async (deliveryId) => {
              await resendNotificationDelivery(deliveryId);
              notifySuccess("通知已加入补发队列");
              await loadDeliveries();
            }}
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
                <Field label="校区"><Select value={form.campus} options={campuses} onChange={(value) => {
                  updateForm("campus", value);
                  setForm((current) => ({
                    ...current,
                    campus: value,
                    classroom: masterLookups.classrooms.find((item) => item.campusId === value)?.id ?? "",
                  }));
                }} /></Field>
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
                <Field label="排课方式">
                  <select value={form.repeatMode} onChange={(event) => updateForm("repeatMode", event.target.value as FormState["repeatMode"])}>
                    <option value="ONCE">仅本次</option>
                    <option value="WEEKLY">按周重复</option>
                  </select>
                </Field>
                {form.repeatMode === "WEEKLY" && (
                  <Field label="重复次数">
                    <input required min="1" max="104" type="number" value={form.repeatCount} onChange={(event) => updateForm("repeatCount", event.target.value)} />
                  </Field>
                )}
                {form.repeatMode === "WEEKLY" && (
                  <Field label="冲突策略" wide>
                    <label className="checkbox-field">
                      <input type="checkbox" checked={form.skipConflicts} onChange={(event) => updateForm("skipConflicts", event.target.checked)} />
                      跳过冲突日期并创建其余课次（默认整批失败）
                    </label>
                  </Field>
                )}
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
                    <Field label="教室" wide><Select value={rescheduleForm.classroom} options={masterLookups.classrooms.filter((item) => item.campusId === selectedSession.campusId)} onChange={(classroom) => setRescheduleForm({ ...rescheduleForm, classroom })} /></Field>
                  </div>
                  <div className="form-note">调课后系统会重新校验时间冲突，并向相关家长发送站内通知。</div>
                </>
              )}
              {(operation === "reschedule" || operation === "cancel") && selectedSession.seriesId && (
                <Field label="系列操作范围">
                  <select value={operationScope} onChange={(event) => setOperationScope(event.target.value as typeof operationScope)}>
                    <option value="THIS">仅本次</option>
                    <option value="THIS_AND_FUTURE">本次及以后</option>
                  </select>
                </Field>
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
      {passwordDialogOpen && (
        <AdminPasswordChangeDialog
          onClose={() => setPasswordDialogOpen(false)}
          onChanged={() => {
            clearRememberedLogin();
            setPasswordDialogOpen(false);
            setAuthUser(undefined);
            setAuthenticated(false);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}</label>;
}

function AdminForcePasswordChange({
  name,
  onChanged,
  onLogout,
}: {
  name: string;
  onChanged: () => void;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await changeAdminPassword(currentPassword, newPassword);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密码修改失败");
    } finally {
      setSubmitting(false);
    }
  };
  return <main className="login-page">
    <form className="login-card" onSubmit={(event) => void submit(event)}>
      <p className="eyebrow">账号安全</p>
      <h1>请先修改密码</h1>
      <p className="platform-login-hint">{name}，临时密码仅可用于首次登录。</p>
      {error && <div className="load-error" role="alert">{error}</div>}
      <Field label="当前密码"><input required minLength={8} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
      <Field label="新密码"><input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
      <Field label="确认新密码"><input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
      <button className="primary-button" disabled={submitting} type="submit">{submitting ? "正在修改…" : "修改密码"}</button>
      <button className="text-button" type="button" onClick={onLogout}>退出登录</button>
    </form>
  </main>;
}

function AdminPasswordChangeDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await changeAdminPassword(currentPassword, newPassword);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密码修改失败");
    } finally {
      setSubmitting(false);
    }
  };
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-label="修改本人密码">
      <div className="dialog-header">
        <h2>修改本人密码</h2>
        <button className="icon-button" aria-label="关闭" disabled={submitting} onClick={onClose}>×</button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        {error && <div className="load-error" role="alert">{error}</div>}
        <div className="form-grid">
          <Field label="当前密码"><input required minLength={8} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
          <Field label="新密码"><input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
          <Field label="确认新密码"><input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" disabled={submitting} onClick={onClose}>取消</button>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "正在保存…" : "保存"}</button>
        </div>
      </form>
    </section>
  </div>;
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
          const firstConflict = conflict.conflicts?.[0];
          const sessionId = conflict.sessionId ?? firstConflict?.sessionId;
          const item = sessions.find((session) => session.id === sessionId);
          return <p className="conflict-detail" key={`${conflict.date ?? ""}-${sessionId ?? ""}`}>
            {conflict.date && `${conflict.date}：`}
            {(conflict.teacherConflict ?? firstConflict?.teacherConflict) && "老师冲突"}
            {(conflict.teacherConflict ?? firstConflict?.teacherConflict) && (conflict.classroomConflict ?? firstConflict?.classroomConflict) && "、"}
            {(conflict.classroomConflict ?? firstConflict?.classroomConflict) && "教室冲突"}
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

const deliveryStatusLabel: Record<NotificationDelivery["status"], string> = {
  PENDING: "待发送",
  SENDING: "发送中",
  SENT: "已发送",
  FAILED: "发送失败",
  SKIPPED: "已跳过",
};

function NotificationDeliveriesView({
  deliveries,
  loading,
  onRefresh,
  onResend,
}: {
  deliveries: NotificationDelivery[];
  loading: boolean;
  onRefresh: () => void;
  onResend: (deliveryId: string) => Promise<void>;
}) {
  const [resendingId, setResendingId] = useState("");
  const [error, setError] = useState("");
  const resend = async (id: string) => {
    setResendingId(id);
    setError("");
    try {
      await onResend(id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "补发失败");
    } finally {
      setResendingId("");
    }
  };
  return <section>
    <div className="intro-row"><p>查看微信订阅消息状态、失败原因并补发。</p><span>共 {deliveries.length} 条记录</span></div>
    <div className="section-heading compact"><div><h2>投递记录</h2><p>发送失败不会回滚预约、取消或调课等业务操作</p></div><button className="secondary-button" onClick={onRefresh}>刷新</button></div>
    {error && <div className="load-error" role="alert">{error}</div>}
    {loading ? <div className="table-state">正在加载投递记录…</div> : deliveries.length === 0 ? <div className="table-state"><strong>暂无投递记录</strong></div> :
      <div className="table-card"><table><thead><tr><th>通知 / 接收人</th><th>状态</th><th>尝试次数</th><th>失败原因</th><th>时间</th><th>操作</th></tr></thead><tbody>
        {deliveries.map((item) => <tr key={item.id}>
          <td><b>{item.notification.title}</b><small>{item.user.name} · {item.channel}</small></td>
          <td><span className={`status delivery-${item.status.toLowerCase()}`}>{deliveryStatusLabel[item.status]}</span></td>
          <td>{item.attemptCount}</td>
          <td className="delivery-error">{item.lastError ?? "—"}</td>
          <td><small>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.sentAt ?? item.createdAt))}</small></td>
          <td>{["FAILED", "SKIPPED"].includes(item.status) ? <button className="text-button" disabled={resendingId === item.id} onClick={() => void resend(item.id)}>{resendingId === item.id ? "提交中…" : "补发"}</button> : "—"}</td>
        </tr>)}
      </tbody></table></div>}
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
