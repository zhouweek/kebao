import { FormEvent, useEffect, useState } from "react";
import {
  AnalyticsFilter,
  AnalyticsResult,
  MasterDataItem,
  exportStatisticsCsv,
  getStatistics,
} from "./api";

interface AnalyticsViewProps {
  campuses: MasterDataItem[];
  courses: MasterDataItem[];
  teachers: MasterDataItem[];
}

interface FilterForm {
  from: string;
  to: string;
  campusId: string;
  courseId: string;
  teacherId: string;
}

function initialFilter(): FilterForm {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const date = (value: Date) => {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 10);
  };
  return {
    from: date(first),
    to: date(nextMonth),
    campusId: "",
    courseId: "",
    teacherId: "",
  };
}

function toQuery(filter: FilterForm): AnalyticsFilter {
  const inclusiveEnd = new Date(`${filter.to}T00:00:00`);
  inclusiveEnd.setDate(inclusiveEnd.getDate() + 1);
  return {
    from: new Date(`${filter.from}T00:00:00`).toISOString(),
    to: inclusiveEnd.toISOString(),
    ...(filter.campusId ? { campusId: filter.campusId } : {}),
    ...(filter.courseId ? { courseId: filter.courseId } : {}),
    ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
  };
}

function percent(value: number) {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function AnalyticsView({
  campuses,
  courses,
  teachers,
}: AnalyticsViewProps) {
  const [form, setForm] = useState<FilterForm>(initialFilter);
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const load = async (filter = form) => {
    setLoading(true);
    setError("");
    try {
      setResult(await getStatistics(toQuery(filter)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "统计数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  const reset = () => {
    const next = initialFilter();
    setForm(next);
    void load(next);
  };

  const download = async () => {
    setExporting(true);
    setError("");
    try {
      const exported = await exportStatisticsCsv(toQuery(form));
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const update = (key: keyof FilterForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const metrics = result?.metrics;
  return (
    <section>
      <div className="intro-row">
        <p>按统一经营口径查看指标，并下钻到有效课次明细。</p>
        {result && (
          <span>
            生成于{" "}
            {new Intl.DateTimeFormat("zh-CN", {
              dateStyle: "short",
              timeStyle: "medium",
            }).format(new Date(result.generatedAt))}
          </span>
        )}
      </div>

      <form className="analytics-filters" onSubmit={submit}>
        <label>
          <span>开始日期</span>
          <input
            aria-label="统计开始日期"
            required
            type="date"
            value={form.from}
            onChange={(event) => update("from", event.target.value)}
          />
        </label>
        <label>
          <span>结束日期</span>
          <input
            aria-label="统计结束日期"
            required
            min={form.from}
            type="date"
            value={form.to}
            onChange={(event) => update("to", event.target.value)}
          />
        </label>
        <label>
          <span>校区</span>
          <select
            aria-label="统计校区"
            value={form.campusId}
            onChange={(event) => update("campusId", event.target.value)}
          >
            <option value="">全部校区</option>
            {campuses.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>课程</span>
          <select
            aria-label="统计课程"
            value={form.courseId}
            onChange={(event) => update("courseId", event.target.value)}
          >
            <option value="">全部课程</option>
            {courses.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>老师</span>
          <select
            aria-label="统计老师"
            value={form.teacherId}
            onChange={(event) => update("teacherId", event.target.value)}
          >
            <option value="">全部老师</option>
            {teachers.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <div className="analytics-filter-actions">
          <button className="secondary-button" type="button" onClick={reset}>重置</button>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "查询中…" : "查询"}
          </button>
        </div>
      </form>

      {error && <div className="load-error" role="alert">{error}</div>}
      <div className="metric-grid analytics-metrics">
        <article className="metric-card accent">
          <p>课次数</p><strong>{metrics?.sessionCount ?? "—"}</strong><small>有效课次</small>
        </article>
        <article className="metric-card">
          <p>预约人次</p><strong>{metrics?.reservationCount ?? "—"}</strong><small>排除课程取消</small>
        </article>
        <article className="metric-card">
          <p>上座率</p><strong>{metrics ? percent(metrics.occupancyRate) : "—"}</strong><small>有效预约 / 总容量</small>
        </article>
        <article className="metric-card">
          <p>取消率</p><strong>{metrics ? percent(metrics.cancellationRate) : "—"}</strong><small>用户取消 / 预约人次</small>
        </article>
        <article className="metric-card">
          <p>到课率</p><strong>{metrics ? percent(metrics.attendanceRate) : "—"}</strong><small>已到 / 已记录考勤</small>
        </article>
      </div>

      <div className="analytics-definition">
        <strong>统计口径</strong>
        <ul>
          {result &&
            Object.values(result.definitions).map((definition) => (
              <li key={definition}>{definition}</li>
            ))}
        </ul>
      </div>

      <div className="section-heading compact">
        <div><h2>课次明细下钻</h2><p>比率按每个有效课次分别计算</p></div>
        <button
          className="secondary-button"
          disabled={exporting || loading}
          onClick={() => void download()}
        >
          {exporting ? "导出中…" : "导出 UTF-8 CSV"}
        </button>
      </div>
      {loading ? (
        <div className="table-state">正在加载统计数据…</div>
      ) : !result?.details.length ? (
        <div className="table-state">
          <strong>当前筛选条件下无有效课次</strong>
          <span>可调整日期、校区、课程或老师后重新查询</span>
        </div>
      ) : (
        <div className="table-card analytics-table">
          <table>
            <thead>
              <tr>
                <th>课次</th><th>校区 / 老师</th><th>容量</th><th>预约</th>
                <th>已到 / 请假 / 缺席</th><th>上座率</th><th>取消率</th><th>到课率</th>
              </tr>
            </thead>
            <tbody>
              {result.details.map((item) => (
                <tr key={item.sessionId}>
                  <td>
                    <b>{item.courseName}</b>
                    <small>{new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(item.startsAt))}</small>
                  </td>
                  <td><b>{item.campusName}</b><small>{item.teacherName}</small></td>
                  <td>{item.capacity}</td>
                  <td><b>{item.reservationCount}</b><small>{item.cancelledBookingCount} 人取消</small></td>
                  <td>{item.attendedCount} / {item.leaveCount} / {item.absentCount}</td>
                  <td>{percent(item.occupancyRate)}</td>
                  <td>{percent(item.cancellationRate)}</td>
                  <td>{percent(item.attendanceRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
