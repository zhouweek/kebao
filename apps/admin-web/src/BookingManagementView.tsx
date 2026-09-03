import { FormEvent, useEffect, useState } from "react";
import {
  AdminBooking,
  AdminBookingQuery,
  BookingStatus,
  CourseSession,
  MasterDataItem,
  cancelAdminBooking,
  createAdminBooking,
  getAdminBookings,
} from "./api";

interface Props {
  sessions: CourseSession[];
  students: MasterDataItem[];
}

interface BookingForm {
  sessionId: string;
  studentId: string;
}

const PAGE_SIZE = 10;

export function BookingManagementView({ sessions, students }: Props) {
  const [items, setItems] = useState<AdminBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AdminBookingQuery>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [bookingForm, setBookingForm] = useState<BookingForm | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminBooking | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async (nextPage = page, nextFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const result = await getAdminBookings({
        ...nextFilters,
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "预约加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1, {});
  }, []);

  const updateFilter = (key: keyof AdminBookingQuery, value: string) => {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    void load(1, filters);
  };

  const openBooking = () => {
    setBookingForm({
      sessionId: sessions.find((item) => ["PUBLISHED", "CLOSED"].includes(item.status))?.id ?? "",
      studentId: students[0]?.id ?? "",
    });
    setError("");
  };

  const submitBooking = async (event: FormEvent) => {
    event.preventDefault();
    if (!bookingForm) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await createAdminBooking(bookingForm.sessionId, bookingForm.studentId);
      setSuccess(result.alreadyBooked ? "该学生已有有效预约" : "代预约成功");
      setBookingForm(null);
      await load(1, filters);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "代预约失败");
    } finally {
      setSubmitting(false);
    }
  };

  const submitCancel = async (event: FormEvent) => {
    event.preventDefault();
    if (!cancelTarget) return;
    setSubmitting(true);
    setError("");
    try {
      await cancelAdminBooking(cancelTarget.id, cancelReason.trim());
      setSuccess("代取消成功");
      setCancelTarget(null);
      setCancelReason("");
      await load(page, filters);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "代取消失败");
    } finally {
      setSubmitting(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-label="预约管理">
      {success && <div className="toast" role="status">{success}</div>}
      {error && <div className="load-error" role="alert">{error}</div>}
      <div className="intro-row">
        <p>查询全部预约，并为学生代预约或代取消。</p>
        <button className="primary-button" onClick={openBooking}>代预约</button>
      </div>
      <form className="booking-filters" onSubmit={search}>
        <label>课次
          <select value={filters.sessionId ?? ""} onChange={(event) => updateFilter("sessionId", event.target.value)}>
            <option value="">全部课次</option>
            {sessions.map((item) => <option key={item.id} value={item.id}>{item.courseName} · {dateTime(item.startsAt)}</option>)}
          </select>
        </label>
        <label>学生
          <select value={filters.studentId ?? ""} onChange={(event) => updateFilter("studentId", event.target.value)}>
            <option value="">全部学生</option>
            {students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>状态
          <select value={filters.status ?? ""} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>开始时间
          <input type="datetime-local" value={localDateTime(filters.from)} onChange={(event) => updateFilter("from", localIso(event.target.value))} />
        </label>
        <label>结束时间
          <input type="datetime-local" value={localDateTime(filters.to)} onChange={(event) => updateFilter("to", localIso(event.target.value))} />
        </label>
        <button className="secondary-button" type="submit">查询</button>
      </form>
      {loading ? <div className="table-state">正在加载预约…</div> : items.length === 0
        ? <div className="table-state"><strong>暂无符合条件的预约</strong></div>
        : <div className="table-card"><table>
          <thead><tr><th>课程 / 课次</th><th>学生</th><th>老师</th><th>状态</th><th>预约时间</th><th>操作</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id}>
            <td><b>{item.session.courseName}</b><small>{dateTime(item.session.startsAt)}</small></td>
            <td><b>{item.student.name}</b><small>{item.student.guardianPhone || "未登记家长电话"}</small></td>
            <td>{item.teacher.name}</td>
            <td><span className={`status status-${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span></td>
            <td>{dateTime(item.createdAt)}</td>
            <td><button className="danger-link" disabled={!activeStatuses.includes(item.status)} onClick={() => {
              setCancelTarget(item);
              setCancelReason("");
              setError("");
            }}>代取消</button></td>
          </tr>)}</tbody>
        </table></div>}
      <div className="pagination">
        <button className="secondary-button" disabled={page <= 1 || loading} onClick={() => void load(page - 1, filters)}>上一页</button>
        <span>第 {page} / {pageCount} 页，共 {total} 条</span>
        <button className="secondary-button" disabled={page >= pageCount || loading} onClick={() => void load(page + 1, filters)}>下一页</button>
      </div>

      {bookingForm && <div className="dialog-backdrop" role="presentation">
        <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="admin-booking-title">
          <div className="dialog-header"><div><p className="eyebrow">管理员操作</p><h2 id="admin-booking-title">代预约</h2></div>
            <button className="icon-button" aria-label="关闭" onClick={() => setBookingForm(null)}>×</button></div>
          <form onSubmit={(event) => void submitBooking(event)}>
            <div className="form-grid">
              <label className="field"><span>课次</span><select required value={bookingForm.sessionId} onChange={(event) => setBookingForm({ ...bookingForm, sessionId: event.target.value })}>
                {sessions.filter((item) => ["PUBLISHED", "CLOSED"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.courseName} · {dateTime(item.startsAt)}</option>)}
              </select></label>
              <label className="field"><span>学生</span><select required value={bookingForm.studentId} onChange={(event) => setBookingForm({ ...bookingForm, studentId: event.target.value })}>
                {students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
            </div>
            <div className="form-note">代预约不受家长预约时间窗限制，但仍校验容量、重复预约和学生时间冲突。</div>
            <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setBookingForm(null)}>取消</button>
              <button className="primary-button" disabled={submitting || !bookingForm.sessionId || !bookingForm.studentId} type="submit">{submitting ? "正在提交…" : "确认代预约"}</button></div>
          </form>
        </section>
      </div>}

      {cancelTarget && <div className="dialog-backdrop" role="presentation">
        <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="admin-cancel-title">
          <div className="dialog-header"><div><p className="eyebrow">{cancelTarget.student.name} · {cancelTarget.session.courseName}</p><h2 id="admin-cancel-title">代取消预约</h2></div>
            <button className="icon-button" aria-label="关闭" onClick={() => setCancelTarget(null)}>×</button></div>
          <form onSubmit={(event) => void submitCancel(event)}>
            <label className="field"><span>取消原因</span><textarea required maxLength={500} rows={4} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="请填写代取消原因，系统将记录到审计日志" /></label>
            <div className="form-note">管理员可越过家长取消截止时间，原因不能为空。</div>
            <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCancelTarget(null)}>返回</button>
              <button className="danger-button" disabled={submitting || !cancelReason.trim()} type="submit">{submitting ? "正在取消…" : "确认代取消"}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}

const activeStatuses: BookingStatus[] = ["CONFIRMED", "ATTENDED", "LEAVE", "ABSENT"];
const statusLabels: Record<BookingStatus, string> = {
  CONFIRMED: "已预约",
  CANCELLED: "已取消",
  COURSE_CANCELLED: "课程取消",
  ATTENDED: "已到",
  LEAVE: "请假",
  ABSENT: "缺席",
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function localIso(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
