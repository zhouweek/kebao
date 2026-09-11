import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  CoursePackageInput,
  CoursePackageItem,
  CoursePackageStatus,
  CreditLedgerItem,
  EntitlementValidityChangeItem,
  MasterDataItem,
  StudentEntitlementItem,
  createCoursePackage,
  createCoursePackagePurchase,
  extendStudentEntitlement,
  getCoursePackages,
  getEntitlementLedger,
  getEntitlementValidityChanges,
  getMasterData,
  getStudentEntitlements,
  setCoursePackageStatus,
  updateCoursePackage,
} from "./api";

type PackageStatus = "在售" | "草稿" | "停售";
type EntitlementStatus = "正常" | "已用完" | "已过期" | "已取消";
type LedgerType = "购课" | "预占" | "释放" | "消课" | "退款" | "调整" | "冲正";
type Tab = "packages" | "entitlements" | "ledger" | "validity";

interface CoursePackage {
  id: string;
  courseId: string;
  name: string;
  course: string;
  lessons: number;
  validityMonths: number;
  priceCents: number;
  price: number;
  sold: number;
  absentDeductsCredit: boolean;
  lateCancellationDeductsCredit: boolean;
  status: PackageStatus;
}

interface Entitlement {
  id: string;
  version: number;
  studentId: string;
  student: string;
  guardian: string;
  packageId: string;
  packageName: string;
  totalLessons: number;
  usedLessons: number;
  reservedLessons: number;
  expiresAt: string;
  status: EntitlementStatus;
}

interface LocalStudentEntity {
  id: string;
  name: string;
  guardian: string;
}

interface LedgerEntry {
  id: string;
  student: string;
  packageName: string;
  type: LedgerType;
  creditChange: number;
  reservedChange: number;
  remainingBalance: number;
  reservedBalance: number;
  happenedAt: string;
  note: string;
}

interface ValidityChange {
  id: string;
  student: string;
  packageName: string;
  previousExpiresAt: string;
  expiresAt: string;
  months: number;
  happenedAt: string;
  reason: string;
}

const packageStatusText: Record<CoursePackageStatus, PackageStatus> = {
  ACTIVE: "在售",
  DRAFT: "草稿",
  INACTIVE: "停售",
};
const packageStatusValue: Record<PackageStatus, CoursePackageStatus> = {
  在售: "ACTIVE",
  草稿: "DRAFT",
  停售: "INACTIVE",
};
const entitlementStatusText: Record<StudentEntitlementItem["status"], EntitlementStatus> = {
  ACTIVE: "正常",
  EXHAUSTED: "已用完",
  EXPIRED: "已过期",
  CANCELLED: "已取消",
};
const ledgerTypeText: Record<CreditLedgerItem["type"], LedgerType> = {
  PURCHASE: "购课",
  RESERVE: "预占",
  RELEASE: "释放",
  CONSUME: "消课",
  REFUND: "退款",
  ADJUSTMENT: "调整",
  REVERSAL: "冲正",
};

function availableLessons(item: Entitlement) {
  return Math.max(0, item.totalLessons - item.usedLessons - item.reservedLessons);
}

export function calculateEntitlementMetrics(
  entitlements: Entitlement[],
  today = formatShanghaiDate(new Date()),
) {
  const valid = entitlements.filter(
    (item) => item.status === "正常" && item.expiresAt >= today,
  );
  const expiringThrough = addDateStringDays(today, 30);
  return {
    activeStudents: new Set(
      valid.filter((item) => availableLessons(item) > 0).map((item) => item.studentId),
    ).size,
    remainingLessons: valid.reduce((sum, item) => sum + availableLessons(item), 0),
    expiring: valid.filter(
      (item) => item.expiresAt >= today && item.expiresAt <= expiringThrough,
    ).length,
  };
}

function addDateStringDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addCalendarMonths(source: Date, months: number) {
  const date = new Date(source);
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, lastDay));
  return date;
}

export function formatShanghaiDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

interface PurchaseRequestFingerprint {
  studentId: string;
  packageId: string;
  paidAmountCents: number;
}

export function createPurchaseIdempotencyKeyStore(
  createKey = () => `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`,
) {
  const keys = new Map<string, string>();
  return {
    get(request: PurchaseRequestFingerprint) {
      const fingerprint = JSON.stringify([
        request.studentId.trim(),
        request.packageId.trim(),
        request.paidAmountCents,
      ]);
      const existing = keys.get(fingerprint);
      if (existing) return existing;
      const key = createKey();
      keys.set(fingerprint, key);
      return key;
    },
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function yuanToCents(value: string): number {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return Number.NaN;
  const yuan = Number(match[1]);
  const fraction = match[2] ?? "";
  const cents = Number((fraction + "00").slice(0, 2));
  const shouldRoundUp = Number(fraction[2] ?? "0") >= 5;
  return yuan * 100 + cents + (shouldRoundUp ? 1 : 0);
}

const PAGE_SIZE = 20;
const SELECT_PAGE_SIZE = 20;

function toCoursePackage(item: CoursePackageItem): CoursePackage {
  return {
    id: item.id,
    courseId: item.courseId,
    name: item.name,
    course: item.courseName,
    lessons: item.creditCount,
    validityMonths: item.validityMonths,
    priceCents: item.priceCents,
    price: item.priceCents / 100,
    sold: item.soldCount,
    absentDeductsCredit: item.absentDeductsCredit,
    lateCancellationDeductsCredit: item.lateCancellationDeductsCredit,
    status: packageStatusText[item.status],
  };
}

function toEntitlement(item: StudentEntitlementItem): Entitlement {
  return {
    id: item.id,
    version: item.version,
    studentId: item.studentId,
    student: item.studentName,
    guardian: `学生 ID · ${item.studentId}`,
    packageId: item.packageId,
    packageName: item.packageName,
    totalLessons: item.totalCredits,
    usedLessons: item.totalCredits - item.remainingCredits,
    reservedLessons: item.reservedCredits,
    expiresAt: formatApiDate(item.validUntil),
    status: entitlementStatusText[item.status],
  };
}

function formatApiDate(value: string) {
  return value.slice(0, 10);
}

function formatApiDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value)).replaceAll("/", "-");
}

function extensionMonths(previous: string, next: string) {
  const from = new Date(previous);
  const to = new Date(next);
  return Math.max(
    1,
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12
      + to.getUTCMonth() - from.getUTCMonth(),
  );
}

function guardianText(student: Pick<MasterDataItem, "phone" | "guardians">) {
  const guardian = student.guardians?.find((item) => item.isPrimary) ?? student.guardians?.[0];
  if (guardian) return `${guardian.name}${guardian.phone ? ` · ${guardian.phone}` : ""}`;
  return student.phone ?? "未绑定家长";
}

export function CoursePackagePrototype() {
  const [tab, setTab] = useState<Tab>("packages");
  const [packages, setPackages] = useState<CoursePackage[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [validityChanges, setValidityChanges] = useState<ValidityChange[]>([]);
  const [packagePage, setPackagePage] = useState(1);
  const [packageTotal, setPackageTotal] = useState(0);
  const [entitlementPage, setEntitlementPage] = useState(1);
  const [entitlementTotal, setEntitlementTotal] = useState(0);
  const [selectedEntitlementId, setSelectedEntitlementId] = useState("");
  const [detailPage, setDetailPage] = useState(1);
  const [detailTotal, setDetailTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [detailKeyword, setDetailKeyword] = useState("");
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<CoursePackage | null>(null);
  const [extendTarget, setExtendTarget] = useState<Entitlement | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [packageLoading, setPackageLoading] = useState(true);
  const [entitlementLoading, setEntitlementLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const noticeTimer = useRef<number | undefined>(undefined);
  const pendingRef = useRef(false);
  const packageGeneration = useRef(0);
  const entitlementGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const refreshMessage = useRef("");

  const refresh = () => setRefreshGeneration((value) => value + 1);

  useEffect(() => {
    const generation = ++packageGeneration.current;
    setPackageLoading(true);
    setError("");
    void getCoursePackages({
      page: packagePage,
      pageSize: PAGE_SIZE,
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
    }).then((result) => {
      if (generation !== packageGeneration.current) return;
      setPackages(result.items.map(toCoursePackage));
      setPackageTotal(result.total);
      if (refreshMessage.current) {
        setError(refreshMessage.current);
        refreshMessage.current = "";
      }
    }).catch((reason) => {
      if (generation === packageGeneration.current) {
        setError(reason instanceof Error ? reason.message : "课包数据加载失败");
      }
    }).finally(() => {
      if (generation === packageGeneration.current) setPackageLoading(false);
    });
    return () => {
      packageGeneration.current += 1;
    };
  }, [keyword, packagePage, refreshGeneration]);

  useEffect(() => {
    const generation = ++entitlementGeneration.current;
    setEntitlementLoading(true);
    setError("");
    setLedger([]);
    setValidityChanges([]);
    detailGeneration.current += 1;
    void getStudentEntitlements({
      page: entitlementPage,
      pageSize: PAGE_SIZE,
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
    }).then((result) => {
      if (generation !== entitlementGeneration.current) return;
      const items = result.items.map(toEntitlement);
      setEntitlements(items);
      setEntitlementTotal(result.total);
      setSelectedEntitlementId((selected) =>
        items.some((item) => item.id === selected) ? selected : items[0]?.id ?? "",
      );
    }).catch((reason) => {
      if (generation === entitlementGeneration.current) {
        setError(reason instanceof Error ? reason.message : "学生权益加载失败");
      }
    }).finally(() => {
      if (generation === entitlementGeneration.current) setEntitlementLoading(false);
    });
    return () => {
      entitlementGeneration.current += 1;
    };
  }, [entitlementPage, keyword, refreshGeneration]);

  useEffect(() => {
    if (tab !== "ledger" && tab !== "validity") {
      detailGeneration.current += 1;
      setDetailLoading(false);
      return;
    }
    const generation = ++detailGeneration.current;
    const entitlementItem = entitlements.find((item) => item.id === selectedEntitlementId);
    if (!entitlementItem) {
      setLedger([]);
      setValidityChanges([]);
      setDetailTotal(0);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setDetailTotal(0);
    if (tab === "ledger") {
      setLedger([]);
    } else {
      setValidityChanges([]);
    }
    const request = tab === "ledger"
      ? getEntitlementLedger(entitlementItem.id, {
          page: detailPage,
          pageSize: PAGE_SIZE,
          ...(detailKeyword.trim() ? { keyword: detailKeyword.trim() } : {}),
        })
      : getEntitlementValidityChanges(entitlementItem.id, {
          page: detailPage,
          pageSize: PAGE_SIZE,
          ...(detailKeyword.trim() ? { keyword: detailKeyword.trim() } : {}),
        });
    void request.then((result) => {
      if (generation !== detailGeneration.current) return;
      setDetailTotal(result.total);
      if (tab === "ledger") {
        setLedger((result.items as CreditLedgerItem[]).map((item) => ({
          id: item.id,
          student: entitlementItem.student,
          packageName: entitlementItem.packageName,
          type: ledgerTypeText[item.type],
          creditChange: item.creditDelta,
          reservedChange: item.reservedCreditDelta,
          remainingBalance: item.balanceAfter,
          reservedBalance: item.reservedBalanceAfter,
          happenedAt: formatApiDateTime(item.occurredAt),
          note: item.note ?? "—",
        })));
      } else {
        setValidityChanges((result.items as EntitlementValidityChangeItem[]).map((item) => ({
          id: item.id,
          student: entitlementItem.student,
          packageName: entitlementItem.packageName,
          previousExpiresAt: formatApiDate(item.previousValidUntil),
          expiresAt: formatApiDate(item.newValidUntil),
          months: extensionMonths(item.previousValidUntil, item.newValidUntil),
          happenedAt: formatApiDateTime(item.createdAt),
          reason: item.reason,
        })));
      }
    }).catch((reason) => {
      if (generation === detailGeneration.current) {
        setError(reason instanceof Error ? reason.message : "权益明细加载失败");
      }
    }).finally(() => {
      if (generation === detailGeneration.current) setDetailLoading(false);
    });
    return () => {
      detailGeneration.current += 1;
    };
  }, [detailKeyword, detailPage, entitlements, selectedEntitlementId, tab]);

  useEffect(() => () => {
    packageGeneration.current += 1;
    entitlementGeneration.current += 1;
    detailGeneration.current += 1;
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
  }, []);

  const metrics = useMemo(() => ({
    activePackages: packages.filter((item) => item.status === "在售").length,
    ...calculateEntitlementMetrics(entitlements),
  }), [entitlements, packages]);

  const showNotice = (message: string) => {
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => {
      setNotice("");
      noticeTimer.current = undefined;
    }, 2400);
  };

  const runMutation = async (action: () => Promise<void>, success: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await action();
      refresh();
      showNotice(success);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        refreshMessage.current = `${reason.message}，已刷新为最新数据`;
        refresh();
      } else {
        setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试");
      }
      throw reason;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <section className="package-prototype" aria-label="课包管理">
      {notice && <div className="toast" role="status">{notice}</div>}
      {error && <div className="error-banner" role="alert">{error} <button className="text-button" onClick={refresh}>重试</button></div>}

      <div className="package-summary">
        <div>
          <p>课包运营概览</p>
          <h2>从售卖到消课，一处掌握</h2>
          <small>当前机构 · 全部校区</small>
        </div>
        <div className="package-summary-actions">
          <button className="secondary-button" disabled={packageLoading} onClick={() => {
            setEditingPackage(null);
            setPackageOpen(true);
          }}>＋ 新增课包</button>
          <button className="primary-button" disabled={packageLoading} onClick={() => setPurchaseOpen(true)}>＋ 录入购买</button>
        </div>
      </div>

      <div className="metric-grid package-metrics">
        <article className="metric-card accent"><p>在售课包（当前页）</p><strong>{metrics.activePackages}</strong><small>当前页 {packages.length} / 共 {packageTotal} 个方案</small></article>
        <article className="metric-card"><p>持有权益学生（当前页）</p><strong>{metrics.activeStudents}</strong><small>当前权益页剩余课时大于 0</small></article>
        <article className="metric-card"><p>可用课时（当前页）</p><strong>{metrics.remainingLessons}</strong><small>当前权益页余额</small></article>
        <article className="metric-card"><p>30 天内到期（当前页）</p><strong>{metrics.expiring}</strong><small>当前权益页统计</small></article>
      </div>

      <div className="package-workspace">
        <div className="package-toolbar">
          <div className="package-tabs" role="tablist" aria-label="课包数据视图">
            <button role="tab" aria-selected={tab === "packages"} className={tab === "packages" ? "active" : ""} onClick={() => setTab("packages")}>课包列表</button>
            <button role="tab" aria-selected={tab === "entitlements"} className={tab === "entitlements" ? "active" : ""} onClick={() => setTab("entitlements")}>学生权益</button>
            <button role="tab" aria-selected={tab === "ledger"} className={tab === "ledger" ? "active" : ""} onClick={() => { setTab("ledger"); setDetailPage(1); }}>课时流水</button>
            <button role="tab" aria-selected={tab === "validity"} className={tab === "validity" ? "active" : ""} onClick={() => { setTab("validity"); setDetailPage(1); }}>有效期变更</button>
          </div>
          <label className="package-search">
            <span className="sr-only">{tab === "ledger" || tab === "validity" ? "搜索当前明细" : "搜索当前列表"}</span>
            {tab === "ledger" || tab === "validity"
              ? <input value={detailKeyword} onChange={(event) => {
                  setDetailKeyword(event.target.value);
                  setDetailPage(1);
                }} placeholder={tab === "ledger" ? "搜索流水类型或备注" : "搜索延期原因"} />
              : <input value={keyword} onChange={(event) => {
                  setKeyword(event.target.value);
                  setPackagePage(1);
                  setEntitlementPage(1);
                  setDetailPage(1);
                }} placeholder="搜索学生、课包或状态" />}
          </label>
        </div>

        {tab === "packages" && (packageLoading
          ? <div className="package-empty" role="status">正在加载课包数据…</div>
          : <><PackageTable
            items={packages}
            disabled={pending}
            onEdit={(item) => {
              setEditingPackage(item);
              setPackageOpen(true);
            }}
            onStatusChange={(id, status) => {
              void runMutation(
                async () => { await setCoursePackageStatus(id, packageStatusValue[status]); },
                `课包状态已更新为「${status}」`,
              ).catch(() => undefined);
            }}
          /><Pagination page={packagePage} pageSize={PAGE_SIZE} total={packageTotal} onChange={setPackagePage} /></>)}
        {tab === "entitlements" && (entitlementLoading
          ? <div className="package-empty" role="status">正在加载学生权益…</div>
          : <><EntitlementTable items={entitlements} onExtend={setExtendTarget} /><Pagination page={entitlementPage} pageSize={PAGE_SIZE} total={entitlementTotal} onChange={setEntitlementPage} /></>)}
        {(tab === "ledger" || tab === "validity") && <>
          <EntitlementDetailControls entitlements={entitlements} selectedId={selectedEntitlementId} entitlementPage={entitlementPage} entitlementTotal={entitlementTotal} onSelect={(id) => { setSelectedEntitlementId(id); setDetailPage(1); }} onEntitlementPageChange={(page) => { setEntitlementPage(page); setDetailPage(1); }} />
          {entitlementLoading || detailLoading
            ? <div className="package-empty" role="status">正在加载所选权益{tab === "ledger" ? "课时流水" : "有效期变更"}…</div>
            : tab === "ledger"
              ? <><LedgerTable items={ledger} /><Pagination label="流水分页" page={detailPage} pageSize={PAGE_SIZE} total={detailTotal} onChange={setDetailPage} /></>
              : <><ValidityChangeTable items={validityChanges} /><Pagination label="延期分页" page={detailPage} pageSize={PAGE_SIZE} total={detailTotal} onChange={setDetailPage} /></>}
        </>}
      </div>

      {packageOpen && (
        <PackageDialog
          item={editingPackage}
          pending={pending}
          onClose={() => setPackageOpen(false)}
          onSubmit={async (item) => {
            try {
              await runMutation(
                async () => {
                  if (editingPackage) {
                    await updateCoursePackage(editingPackage.id, item);
                  } else {
                    await createCoursePackage(item);
                  }
                },
                editingPackage ? `课包「${item.name}」已更新` : `课包「${item.name}」已新增`,
              );
              setPackageOpen(false);
            } catch {
              // 错误由页面统一展示，保留表单方便修正后重试。
            }
          }}
        />
      )}

      {purchaseOpen && (
        <PurchaseDialog
          pending={pending}
          onClose={() => setPurchaseOpen(false)}
          onSubmit={async (student, selectedPackage, idempotencyKey) => {
            try {
              await runMutation(
                async () => {
                  await createCoursePackagePurchase({
                    packageId: selectedPackage.id,
                    studentId: student.id,
                    paidAmountCents: selectedPackage.priceCents,
                    note: "管理后台线下录入",
                    idempotencyKey,
                  });
                },
                `已为 ${student.name} 录入购买`,
              );
              setPurchaseOpen(false);
            } catch {
              // 错误由页面统一展示。
            }
          }}
        />
      )}

      {extendTarget && (
        <ExtendDialog
          target={extendTarget}
          pending={pending}
          onClose={() => setExtendTarget(null)}
          onSubmit={async (months, reason) => {
            try {
              await runMutation(
                async () => {
                  await extendStudentEntitlement(extendTarget.id, {
                    months,
                    reason,
                    version: extendTarget.version,
                  });
                },
                `已为 ${extendTarget.student} 延长 ${months} 个月`,
              );
              setExtendTarget(null);
            } catch (reason) {
              if (reason instanceof ApiError && reason.status === 409) {
                setExtendTarget(null);
              }
            }
          }}
        />
      )}
    </section>
  );
}

function Pagination({ page, pageSize, total, onChange, label = "分页" }: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  label?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <div className="package-pagination" aria-label={label}>
    <span>第 {page} / {pageCount} 页，共 {total} 条</span>
    <button className="secondary-button" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button>
    <button className="secondary-button" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>下一页</button>
  </div>;
}

function EntitlementDetailControls({ entitlements, selectedId, entitlementPage, entitlementTotal, onSelect, onEntitlementPageChange }: { entitlements: Entitlement[]; selectedId: string; entitlementPage: number; entitlementTotal: number; onSelect: (id: string) => void; onEntitlementPageChange: (page: number) => void }) {
  return <div className="package-detail-controls">
    <label className="field"><span>选择权益</span><select aria-label="选择权益" value={selectedId} disabled={entitlements.length === 0} onChange={(event) => onSelect(event.target.value)}>
      {entitlements.length === 0 && <option value="">当前页暂无权益</option>}
      {entitlements.map((item) => <option key={item.id} value={item.id}>{item.student} · {item.packageName}</option>)}
    </select></label>
    <Pagination label="权益选择分页" page={entitlementPage} pageSize={PAGE_SIZE} total={entitlementTotal} onChange={onEntitlementPageChange} />
  </div>;
}

function PackageTable({ items, disabled, onEdit, onStatusChange }: { items: CoursePackage[]; disabled: boolean; onEdit: (item: CoursePackage) => void; onStatusChange: (id: string, status: PackageStatus) => void }) {
  return <div className="table-card package-table"><table>
    <thead><tr><th>课包名称</th><th>课时 / 有效期</th><th>扣课规则</th><th>售价</th><th>已售</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.id}>
      <td><b>{item.name}</b><small>{item.course}</small></td>
      <td><b>{item.lessons} 课时</b><small>购买后 {item.validityMonths} 个月有效</small></td>
      <td><span className="package-rule-list">
        <small>{item.absentDeductsCredit ? "缺席扣课" : "缺席不扣课"}</small>
        <small>{item.lateCancellationDeductsCredit ? "晚取消扣课" : "晚取消不扣课"}</small>
      </span></td>
      <td><b>{formatMoney(item.price)}</b></td>
      <td>{item.sold} 份</td>
      <td><span className={`status package-status-${item.status}`}>{item.status}</span></td>
      <td><span className="package-row-actions">
        <button type="button" className="text-button" aria-label={`编辑${item.name}`} disabled={disabled} onClick={() => onEdit(item)}>编辑</button>
        <select aria-label={`${item.name}状态`} value={item.status} disabled={disabled} onChange={(event) => onStatusChange(item.id, event.target.value as PackageStatus)}>
          <option>在售</option><option>草稿</option><option>停售</option>
        </select>
      </span></td>
    </tr>)}</tbody>
  </table>{items.length === 0 && <div className="package-empty">没有匹配的课包</div>}</div>;
}

function EntitlementTable({ items, onExtend }: { items: Entitlement[]; onExtend: (item: Entitlement) => void }) {
  return <div className="table-card package-table"><table>
    <thead><tr><th>学生</th><th>持有课包</th><th>课时权益</th><th>有效期至</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.id}>
      <td><b>{item.student}</b><small>{item.guardian}</small></td>
      <td><b>{item.packageName}</b><small>共 {item.totalLessons} 课时</small></td>
      <td><div className="entitlement-counts">
        <span><small>已用</small><b>{item.usedLessons}</b></span>
        <span><small>预占</small><b>{item.reservedLessons}</b></span>
        <span className="available"><small>可用</small><b>{availableLessons(item)}</b></span>
      </div><span className="progress package-progress"><i style={{ width: `${item.totalLessons ? availableLessons(item) / item.totalLessons * 100 : 0}%` }} /></span></td>
      <td>{item.expiresAt}</td>
      <td><span className={`status entitlement-status-${item.status}`}>{item.status}</span></td>
      <td><button className="text-button" onClick={() => onExtend(item)}>延期有效期</button></td>
    </tr>)}</tbody>
  </table>{items.length === 0 && <div className="package-empty">没有匹配的学生权益</div>}</div>;
}

function LedgerTable({ items }: { items: LedgerEntry[] }) {
  return <div className="table-card package-table"><table>
    <thead><tr><th>发生时间</th><th>学生 / 课包</th><th>类型</th><th>课时变动</th><th>预占变动</th><th>剩余 / 预占</th><th>备注</th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.id}>
      <td>{item.happenedAt}</td>
      <td><b>{item.student}</b><small>{item.packageName}</small></td>
      <td><span className={`ledger-type ledger-${item.type}`}>{item.type}</span></td>
      <td><b className={item.creditChange > 0 ? "positive-number" : item.creditChange < 0 ? "negative-number" : ""}>{item.creditChange > 0 ? `+${item.creditChange}` : item.creditChange}</b></td>
      <td><b className={item.reservedChange > 0 ? "negative-number" : item.reservedChange < 0 ? "positive-number" : ""}>{item.reservedChange > 0 ? `+${item.reservedChange}` : item.reservedChange}</b></td>
      <td><b>{item.remainingBalance}</b><small>预占 {item.reservedBalance}</small></td>
      <td>{item.note}</td>
    </tr>)}</tbody>
  </table>{items.length === 0 && <div className="package-empty">没有匹配的课时流水</div>}</div>;
}

function ValidityChangeTable({ items }: { items: ValidityChange[] }) {
  return <div className="table-card package-table"><table>
    <thead><tr><th>变更时间</th><th>学生 / 课包</th><th>原到期日</th><th>新到期日</th><th>延期</th><th>原因</th></tr></thead>
    <tbody>{items.map((item) => <tr key={item.id}>
      <td>{item.happenedAt}</td>
      <td><b>{item.student}</b><small>{item.packageName}</small></td>
      <td>{item.previousExpiresAt}</td>
      <td><b>{item.expiresAt}</b></td>
      <td><span className="validity-change">+{item.months} 个月</span></td>
      <td>{item.reason}</td>
    </tr>)}</tbody>
  </table>{items.length === 0 && <div className="package-empty">没有匹配的有效期变更</div>}</div>;
}

function PackageDialog({ item, pending, onClose, onSubmit }: {
  item: CoursePackage | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (item: CoursePackageInput) => Promise<void>;
}) {
  const [courses, setCourses] = useState<MasterDataItem[]>([]);
  const [coursePage, setCoursePage] = useState(1);
  const [courseTotal, setCourseTotal] = useState(0);
  const [courseKeyword, setCourseKeyword] = useState("");
  const [courseLoading, setCourseLoading] = useState(true);
  const [courseError, setCourseError] = useState("");
  const [name, setName] = useState(item?.name ?? "新课包");
  const [courseId, setCourseId] = useState(item?.courseId ?? "");
  const [lessons, setLessons] = useState(String(item?.lessons ?? 64));
  const [validityMonths, setValidityMonths] = useState(String(item?.validityMonths ?? 24));
  const [price, setPrice] = useState(String(item?.price ?? 9980));
  const [status, setStatus] = useState<PackageStatus>(item?.status ?? "草稿");
  const [absentDeductsCredit, setAbsentDeductsCredit] = useState(item?.absentDeductsCredit ?? false);
  const [lateCancellationDeductsCredit, setLateCancellationDeductsCredit] = useState(item?.lateCancellationDeductsCredit ?? false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setCourseLoading(true);
    setCourseError("");
    void getMasterData("courses", {
      page: coursePage,
      pageSize: SELECT_PAGE_SIZE,
      ...(courseKeyword.trim() ? { keyword: courseKeyword.trim() } : {}),
      activeOnly: true,
    }).then((result) => {
      if (current !== generation.current) return;
      setCourses(result.items);
      setCourseTotal(result.total);
      setCourseId((selected) => result.items.some((item) => item.id === selected)
        ? selected
        : item?.courseId ?? result.items[0]?.id ?? "");
    }).catch((reason) => {
      if (current === generation.current) {
        setCourseError(reason instanceof Error ? reason.message : "课程加载失败");
      }
    }).finally(() => {
      if (current === generation.current) setCourseLoading(false);
    });
    return () => {
      generation.current += 1;
    };
  }, [courseKeyword, coursePage]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({
      name: name.trim(),
      courseId,
      creditCount: Number(lessons),
      validityMonths: Number(validityMonths),
      priceCents: yuanToCents(price),
      absentDeductsCredit,
      lateCancellationDeductsCredit,
      status: packageStatusValue[status],
    });
  };
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="package-title">
      <div className="dialog-header"><div><p className="eyebrow">课包配置</p><h2 id="package-title">{item ? "编辑课包" : "新增课包"}</h2></div><button className="icon-button" aria-label="关闭" disabled={pending} onClick={onClose}>×</button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>课包名称</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field"><span>搜索课程</span><input value={courseKeyword} onChange={(event) => {
            setCourseKeyword(event.target.value);
            setCoursePage(1);
          }} placeholder="按课程名称搜索" /></label>
          <label className="field wide"><span>关联课程</span><select required disabled={courseLoading} value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">{courseLoading ? "加载中…" : "请选择课程"}</option>{item && !courses.some((course) => course.id === item.courseId) && <option value={item.courseId}>{item.course}</option>}{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
          <div className="field wide"><Pagination page={coursePage} pageSize={SELECT_PAGE_SIZE} total={courseTotal} onChange={setCoursePage} /></div>
          <label className="field"><span>课时数</span><input type="number" required min="1" value={lessons} onChange={(event) => setLessons(event.target.value)} /></label>
          <label className="field"><span>有效期（月）</span><input type="number" required min="1" max="120" value={validityMonths} onChange={(event) => setValidityMonths(event.target.value)} /></label>
          <label className="field"><span>售价（元）</span><input type="number" required min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          <label className="field"><span>初始状态</span><select value={status} onChange={(event) => setStatus(event.target.value as PackageStatus)}><option>草稿</option><option>在售</option><option>停售</option></select></label>
          <label className="field rule-toggle"><span>缺席规则</span><span className="checkbox-field"><input aria-label="缺席扣课" type="checkbox" checked={absentDeductsCredit} onChange={(event) => setAbsentDeductsCredit(event.target.checked)} />缺席扣课</span><small>开启后，学员被记为缺席时扣除 1 课时。</small></label>
          <label className="field rule-toggle"><span>晚取消规则</span><span className="checkbox-field"><input aria-label="晚取消扣课" type="checkbox" checked={lateCancellationDeductsCredit} onChange={(event) => setLateCancellationDeductsCredit(event.target.checked)} />晚取消扣课</span><small>开启后，超过取消截止时间仍取消将扣除 1 课时。</small></label>
        </div>
        {courseError
          ? <div className="form-note">{courseError}</div>
          : courses.length === 0 && !courseLoading && <div className="form-note">暂无可用课程，请先在基础资料中启用课程。</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={pending || !courseId}>{pending ? "保存中…" : item ? "确认保存" : "确认新增"}</button></div>
      </form>
    </section>
  </div>;
}

function PurchaseDialog({ pending, onClose, onSubmit }: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (
    student: LocalStudentEntity,
    selectedPackage: CoursePackage,
    idempotencyKey: string,
  ) => Promise<void>;
}) {
  const [students, setStudents] = useState<LocalStudentEntity[]>([]);
  const [packages, setPackages] = useState<CoursePackage[]>([]);
  const [studentPage, setStudentPage] = useState(1);
  const [studentTotal, setStudentTotal] = useState(0);
  const [studentKeyword, setStudentKeyword] = useState("");
  const [packagePage, setPackagePage] = useState(1);
  const [packageTotal, setPackageTotal] = useState(0);
  const [packageKeyword, setPackageKeyword] = useState("");
  const [studentLoading, setStudentLoading] = useState(true);
  const [packageLoading, setPackageLoading] = useState(true);
  const [optionError, setOptionError] = useState("");
  const [studentId, setStudentId] = useState("");
  const [packageId, setPackageId] = useState("");
  const studentGeneration = useRef(0);
  const packageGeneration = useRef(0);
  const [idempotencyKeys] = useState(createPurchaseIdempotencyKeyStore);
  useEffect(() => {
    const current = ++studentGeneration.current;
    setStudentLoading(true);
    setOptionError("");
    void getMasterData("students", {
      page: studentPage,
      pageSize: SELECT_PAGE_SIZE,
      ...(studentKeyword.trim() ? { keyword: studentKeyword.trim() } : {}),
      activeOnly: true,
    }).then((result) => {
      if (current !== studentGeneration.current) return;
      const items = result.items.map((item) => ({
        id: item.id,
        name: item.name,
        guardian: guardianText(item),
      }));
      setStudents(items);
      setStudentTotal(result.total);
      setStudentId((selected) => items.some((item) => item.id === selected)
        ? selected
        : items[0]?.id ?? "");
    }).catch((reason) => {
      if (current === studentGeneration.current) {
        setOptionError(reason instanceof Error ? reason.message : "学生加载失败");
      }
    }).finally(() => {
      if (current === studentGeneration.current) setStudentLoading(false);
    });
    return () => {
      studentGeneration.current += 1;
    };
  }, [studentKeyword, studentPage]);
  useEffect(() => {
    const current = ++packageGeneration.current;
    setPackageLoading(true);
    setOptionError("");
    void getCoursePackages({
      page: packagePage,
      pageSize: SELECT_PAGE_SIZE,
      ...(packageKeyword.trim() ? { keyword: packageKeyword.trim() } : {}),
      status: "ACTIVE",
    }).then((result) => {
      if (current !== packageGeneration.current) return;
      const items = result.items.map(toCoursePackage);
      setPackages(items);
      setPackageTotal(result.total);
      setPackageId((selected) => items.some((item) => item.id === selected)
        ? selected
        : items[0]?.id ?? "");
    }).catch((reason) => {
      if (current === packageGeneration.current) {
        setOptionError(reason instanceof Error ? reason.message : "课包加载失败");
      }
    }).finally(() => {
      if (current === packageGeneration.current) setPackageLoading(false);
    });
    return () => {
      packageGeneration.current += 1;
    };
  }, [packageKeyword, packagePage]);
  const student = students.find((item) => item.id === studentId);
  const selected = packages.find((item) => item.id === packageId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (student && selected) {
      const idempotencyKey = idempotencyKeys.get({
        studentId: student.id,
        packageId: selected.id,
        paidAmountCents: selected.priceCents,
      });
      void onSubmit(student, selected, idempotencyKey);
    }
  };
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-title">
      <div className="dialog-header"><div><p className="eyebrow">线下购买录入</p><h2 id="purchase-title">录入购买</h2></div><button className="icon-button" aria-label="关闭" disabled={pending} onClick={onClose}>×</button></div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field wide"><span>搜索学生</span><input value={studentKeyword} onChange={(event) => {
            setStudentKeyword(event.target.value);
            setStudentPage(1);
          }} placeholder="按学生姓名搜索" /></label>
          <label className="field wide"><span>选择学生</span><select required value={studentId} onChange={(event) => setStudentId(event.target.value)}>{students.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.guardian}</option>)}</select></label>
          <div className="field wide"><Pagination page={studentPage} pageSize={SELECT_PAGE_SIZE} total={studentTotal} onChange={setStudentPage} /></div>
          <label className="field"><span>学生 ID</span><input readOnly value={student?.id ?? ""} /></label>
          <label className="field"><span>家长信息</span><input readOnly value={student?.guardian ?? ""} /></label>
          <label className="field wide"><span>搜索课包</span><input value={packageKeyword} onChange={(event) => {
            setPackageKeyword(event.target.value);
            setPackagePage(1);
          }} placeholder="按课包名称搜索" /></label>
          <label className="field wide"><span>购买课包</span><select required value={packageId} onChange={(event) => setPackageId(event.target.value)}>{packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.price)}</option>)}</select></label>
          <div className="field wide"><Pagination page={packagePage} pageSize={SELECT_PAGE_SIZE} total={packageTotal} onChange={setPackagePage} /></div>
        </div>
        {selected && <div className="purchase-preview"><span><b>{selected.lessons}</b> 课时</span><span><b>{selected.validityMonths}</b> 个月有效</span><span><b>{formatMoney(selected.price)}</b> 应收</span></div>}
        {optionError
          ? <div className="form-note">{optionError}</div>
          : (!students.length || !packages.length) && !studentLoading && !packageLoading && <div className="form-note">需要至少一名可用学生和一个在售课包才能录入购买。</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={pending || studentLoading || packageLoading || !student || !selected}>{pending ? "录入中…" : "确认录入"}</button></div>
      </form>
    </section>
  </div>;
}

function ExtendDialog({ target, pending, onClose, onSubmit }: {
  target: Entitlement;
  pending: boolean;
  onClose: () => void;
  onSubmit: (months: number, reason: string) => Promise<void>;
}) {
  const [months, setMonths] = useState("1");
  const [reason, setReason] = useState("家长申请");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(Number(months), reason.trim());
  };
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="extend-title">
      <div className="dialog-header"><div><p className="eyebrow">{target.student} · {target.packageName}</p><h2 id="extend-title">延期有效期</h2></div><button className="icon-button" aria-label="关闭" disabled={pending} onClick={onClose}>×</button></div>
      <form onSubmit={submit}>
        <div className="entitlement-snapshot"><span>当前到期日</span><b>{target.expiresAt}</b><small>可用 {availableLessons(target)} 课时</small></div>
        <div className="form-grid">
          <label className="field"><span>延长月数</span><input aria-label="延长月数" type="number" required min="1" max="120" value={months} onChange={(event) => setMonths(event.target.value)} /></label>
          <label className="field"><span>延期原因</span><select aria-label="延期原因" value={reason} onChange={(event) => setReason(event.target.value)}><option>家长申请</option><option>停课补偿</option><option>运营调整</option><option>其他</option></select></label>
        </div>
        <div className="form-note">按自然月计算新到期日，并在独立的“有效期变更”视图中留痕。</div>
        <div className="dialog-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={pending}>{pending ? "保存中…" : "确认延期"}</button></div>
      </form>
    </section>
  </div>;
}
