import { FormEvent, useEffect, useState } from "react";
import {
  MasterDataItem,
  MasterResource,
  deleteMasterData,
  getMasterData,
  saveMasterData,
  setMasterDataActive,
  setStudentGuardians,
} from "./api";

const labels: Record<MasterResource, string> = {
  campuses: "校区",
  classrooms: "教室",
  courses: "课程",
  teachers: "老师",
  guardians: "家长",
  students: "学生",
};

interface Props {
  resource: MasterResource;
  campuses: MasterDataItem[];
  guardians: MasterDataItem[];
  onChanged: () => Promise<void>;
}

function initialValues(resource: MasterResource): Record<string, string> {
  return {
    name: "",
    phone: "",
    email: "",
    address: "",
    timezone: "Asia/Shanghai",
    campusId: "",
    code: "",
    capacity: resource === "classrooms" ? "12" : "",
    durationMinutes: resource === "courses" ? "60" : "",
    description: "",
    specialty: "",
    remark: "",
    gender: "",
    birthDate: "",
  };
}

export function MasterDataView({ resource, campuses, guardians, onChanged }: Props) {
  const [items, setItems] = useState<MasterDataItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState<"" | "true" | "false">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<MasterDataItem | null | undefined>(undefined);
  const [values, setValues] = useState(() => initialValues(resource));
  const [binding, setBinding] = useState<MasterDataItem | null>(null);
  const [guardianIds, setGuardianIds] = useState<string[]>([]);
  const pageSize = 10;

  const load = async (targetPage = page) => {
    setLoading(true);
    setError("");
    try {
      const result = await getMasterData(resource, {
        page: targetPage,
        pageSize,
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(active ? { activeOnly: active === "true" } : {}),
      });
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "基础资料加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    setEditing(undefined);
    void load(1);
  }, [resource]);

  const openEditor = (item: MasterDataItem | null) => {
    setEditing(item);
    setValues(
      item
        ? Object.fromEntries(
            Object.entries(initialValues(resource)).map(([key, fallback]) => [
              key,
              item[key as keyof MasterDataItem] == null
                ? fallback
                : String(item[key as keyof MasterDataItem]),
            ]),
          )
        : initialValues(resource),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const input: Record<string, unknown> = { name: values.name };
      const fields =
        resource === "campuses"
          ? ["address", "phone", "timezone"]
          : resource === "classrooms"
            ? ["campusId", "code"]
            : resource === "courses"
              ? ["code", "description"]
              : resource === "teachers"
                ? ["phone", "email", "specialty", "remark"]
                : resource === "guardians"
                  ? ["phone", "email", "remark"]
                  : ["phone", "gender", "birthDate", "campusId", "remark"];
      fields.forEach((field) => {
        input[field] = values[field] || null;
      });
      if (resource === "classrooms") input.capacity = Number(values.capacity);
      if (resource === "courses") input.durationMinutes = Number(values.durationMinutes);
      await saveMasterData(resource, input, editing?.id);
      setEditing(undefined);
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (item: MasterDataItem) => {
    try {
      await setMasterDataActive(resource, item.id, !item.isActive);
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "状态更新失败");
    }
  };

  const remove = async (item: MasterDataItem) => {
    if (!window.confirm(`确定删除${labels[resource]}“${item.name}”吗？`)) return;
    try {
      await deleteMasterData(resource, item.id);
      await load();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  };

  const openBinding = (student: MasterDataItem) => {
    setBinding(student);
    setGuardianIds(student.guardians?.map((item) => item.id) ?? []);
  };

  const saveBinding = async () => {
    if (!binding) return;
    try {
      await setStudentGuardians(
        binding.id,
        guardianIds.map((guardianId, index) => ({
          guardianId,
          relationship: "监护人",
          isPrimary: index === 0,
        })),
      );
      setBinding(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "绑定失败");
    }
  };

  return (
    <section>
      <div className="intro-row">
        <p>维护机构内{labels[resource]}资料，支持分页、筛选和启停。</p>
        <span>共 {total} 条</span>
      </div>
      <div className="master-toolbar">
        <form
          className="filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load(1);
          }}
        >
          <input
            aria-label="搜索关键词"
            placeholder="按名称、编码或联系方式搜索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <select aria-label="启用状态" value={active} onChange={(event) => setActive(event.target.value as typeof active)}>
            <option value="">全部状态</option>
            <option value="true">已启用</option>
            <option value="false">已停用</option>
          </select>
          <button className="secondary-button" type="submit">筛选</button>
        </form>
        <button className="primary-button" onClick={() => openEditor(null)}>新增{labels[resource]}</button>
      </div>
      {error && <div className="load-error" role="alert">{error}</div>}
      {loading && items.length === 0 ? (
        <div className="table-state">正在加载{labels[resource]}…</div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr><th>名称</th><th>关键信息</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><b>{item.name}</b><small>{item.code ?? item.phone ?? "—"}</small></td>
                  <td><b>{item.campusName ?? item.specialty ?? item.address ?? "—"}</b><small>{item.capacity ? `容量 ${item.capacity} 人` : item.durationMinutes ? `${item.durationMinutes} 分钟` : item.email ?? item.remark ?? ""}</small></td>
                  <td><span className={`status ${item.isActive ? "" : "status-cancelled"}`}>{item.isActive ? "已启用" : "已停用"}</span></td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => openEditor(item)}>编辑</button>
                      {resource === "students" && <button onClick={() => openBinding(item)}>绑定家长</button>}
                      <button onClick={() => void toggle(item)}>{item.isActive ? "停用" : "启用"}</button>
                      <button className="danger-link" onClick={() => void remove(item)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && <div className="table-state small">暂无{labels[resource]}资料</div>}
        </div>
      )}
      <div className="pagination">
        <button className="secondary-button" disabled={page <= 1} onClick={() => void load(page - 1)}>上一页</button>
        <span>第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页</span>
        <button className="secondary-button" disabled={page * pageSize >= total} onClick={() => void load(page + 1)}>下一页</button>
      </div>

      {editing !== undefined && (
        <div className="dialog-backdrop">
          <section className="dialog" role="dialog" aria-modal="true" aria-label={`${editing ? "编辑" : "新增"}${labels[resource]}`}>
            <div className="dialog-header">
              <h2>{editing ? "编辑" : "新增"}{labels[resource]}</h2>
              <button className="icon-button" aria-label="关闭" onClick={() => setEditing(undefined)}>×</button>
            </div>
            <form onSubmit={(event) => void submit(event)}>
              <div className="form-grid">
                <EditorFields resource={resource} values={values} campuses={campuses} onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))} />
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" onClick={() => setEditing(undefined)}>取消</button>
                <button type="submit" className="primary-button" disabled={loading}>保存</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {binding && (
        <div className="dialog-backdrop">
          <section className="dialog" role="dialog" aria-modal="true" aria-label="绑定家长">
            <div className="dialog-header"><h2>为 {binding.name} 绑定家长</h2><button className="icon-button" aria-label="关闭" onClick={() => setBinding(null)}>×</button></div>
            <div className="guardian-picker">
              {guardians.map((guardian) => (
                <label key={guardian.id}>
                  <input
                    type="checkbox"
                    checked={guardianIds.includes(guardian.id)}
                    onChange={(event) => setGuardianIds((current) =>
                      event.target.checked
                        ? [...current, guardian.id]
                        : current.filter((id) => id !== guardian.id),
                    )}
                  />
                  <span>{guardian.name}<small>{guardian.phone}</small></span>
                </label>
              ))}
              {guardians.length === 0 && <div className="table-state small">请先新增已启用家长</div>}
            </div>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setBinding(null)}>取消</button>
              <button className="primary-button" onClick={() => void saveBinding()}>保存绑定</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function EditorFields({
  resource,
  values,
  campuses,
  onChange,
}: {
  resource: MasterResource;
  values: Record<string, string>;
  campuses: MasterDataItem[];
  onChange: (field: string, value: string) => void;
}) {
  const field = (name: string, label: string, type = "text", required = false) => (
    <label className="field">
      <span>{label}</span>
      <input required={required} type={type} value={values[name] ?? ""} onChange={(event) => onChange(name, event.target.value)} />
    </label>
  );
  return (
    <>
      {field("name", "名称", "text", true)}
      {resource === "campuses" && <>{field("address", "地址")}{field("phone", "联系电话")}{field("timezone", "时区", "text", true)}</>}
      {resource === "classrooms" && <>
        <label className="field"><span>所属校区</span><select required value={values.campusId} onChange={(event) => onChange("campusId", event.target.value)}><option value="">请选择</option>{campuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {field("code", "教室编码")}{field("capacity", "容量", "number", true)}
      </>}
      {resource === "courses" && <>{field("code", "课程编码")}{field("durationMinutes", "默认时长（分钟）", "number", true)}{field("description", "课程说明")}</>}
      {(resource === "teachers" || resource === "guardians") && <>{field("phone", "手机号")}{field("email", "邮箱", "email")}</>}
      {resource === "teachers" && field("specialty", "擅长课程")}
      {resource === "students" && <>
        {field("phone", "联系电话")}{field("gender", "性别")}{field("birthDate", "出生日期", "date")}
        <label className="field"><span>所属校区</span><select value={values.campusId} onChange={(event) => onChange("campusId", event.target.value)}><option value="">未指定</option>{campuses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </>}
      {["teachers", "guardians", "students"].includes(resource) && field("remark", "备注")}
    </>
  );
}
