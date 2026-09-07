import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Organization,
  OrganizationAdmin,
  PLATFORM_AUTH_CLEARED_EVENT,
  PLATFORM_AUTH_STORAGE_KEY,
  PlatformAuditLog,
  changePlatformPassword,
  clearPlatformAuth,
  deleteOrganization,
  getPlatformMe,
  getPlatformAuthSnapshot,
  getStoredPlatformAuth,
  hasPlatformAuth,
  invalidatePlatformAuthSnapshots,
  isPlatformAuthSnapshotCurrent,
  listOrganizationAdmins,
  listOrganizations,
  listPlatformAuditLogs,
  loginPlatform,
  logoutPlatform,
  resetOrganizationAdminPassword,
  revokeOrganizationAdminSessions,
  saveOrganization,
  saveOrganizationAdmin,
  setOrganizationActive,
  setOrganizationAdminActive,
} from "./platform-api";

type Dialog =
  | { kind: "organization"; item?: Organization }
  | { kind: "admin"; item?: OrganizationAdmin }
  | { kind: "temporary-password"; value: string }
  | { kind: "change-password" }
  | null;

const emptyOrganization = { code: "", name: "" };
const emptyAdmin = { name: "", phone: "", email: "" };

const platformAuditActionLabel: Record<string, string> = {
  ORGANIZATION_CREATED: "创建机构",
  ORGANIZATION_UPDATED: "更新机构",
  ORGANIZATION_ENABLED: "启用机构",
  ORGANIZATION_DISABLED: "停用机构",
  ORGANIZATION_DELETED: "删除机构",
  TENANT_ADMIN_CREATED: "创建机构管理员",
  TENANT_ADMIN_UPDATED: "更新机构管理员",
  TENANT_ADMIN_ENABLED: "启用机构管理员",
  TENANT_ADMIN_DISABLED: "停用机构管理员",
  TENANT_ADMIN_PASSWORD_RESET: "重置管理员密码",
  TENANT_ADMIN_SESSIONS_REVOKED: "撤销管理员会话",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function PlatformApp() {
  const [authenticated, setAuthenticated] = useState(hasPlatformAuth);
  const [user, setUser] = useState(getStoredPlatformAuth()?.account);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [admins, setAdmins] = useState<OrganizationAdmin[]>([]);
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLog[]>([]);
  const [view, setView] = useState<"management" | "audit">("management");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [organizationForm, setOrganizationForm] = useState(emptyOrganization);
  const [adminForm, setAdminForm] = useState(emptyAdmin);
  const [resettingAdminId, setResettingAdminId] = useState<string | null>(null);
  const adminRequestSequence = useRef(0);
  const adminSubmissionSequence = useRef(0);
  const adminSubmissionInFlight = useRef(false);
  const selectedOrganizationIdRef = useRef(selectedOrganizationId);
  const resetPasswordInFlight = useRef(false);
  const requestEpoch = useRef(0);
  const [authRevision, setAuthRevision] = useState(0);
  selectedOrganizationIdRef.current = selectedOrganizationId;

  const selectedOrganization =
    organizations.find((item) => item.id === selectedOrganizationId) ?? organizations[0];

  const notify = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(""), 3000);
  };

  const invalidatePlatformUi = () => {
    requestEpoch.current += 1;
    adminRequestSequence.current += 1;
    adminSubmissionSequence.current += 1;
    adminSubmissionInFlight.current = false;
    resetPasswordInFlight.current = false;
    setUser(undefined);
    setOrganizations([]);
    setSelectedOrganizationId("");
    selectedOrganizationIdRef.current = "";
    setAdmins([]);
    setAuditLogs([]);
    setView("management");
    setDialog(null);
    setResettingAdminId(null);
    setSubmitting(false);
    setError("");
    setSuccess("");
  };

  const loadOrganizations = async () => {
    const epoch = requestEpoch.current;
    const authSnapshot = getPlatformAuthSnapshot();
    const isCurrentRequest = () =>
      epoch === requestEpoch.current && isPlatformAuthSnapshotCurrent(authSnapshot);
    setLoading(true);
    setError("");
    try {
      const items = await listOrganizations();
      if (!isCurrentRequest()) return;
      setOrganizations(items);
      setSelectedOrganizationId((current) => {
        const next = items.some((item) => item.id === current) ? current : items[0]?.id ?? "";
        selectedOrganizationIdRef.current = next;
        return next;
      });
    } catch (reason) {
      if (isCurrentRequest()) setError(errorMessage(reason, "机构加载失败"));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  const loadAdmins = async (organizationId: string) => {
    const epoch = requestEpoch.current;
    const authSnapshot = getPlatformAuthSnapshot();
    const requestSequence = ++adminRequestSequence.current;
    const isCurrentRequest = () =>
      epoch === requestEpoch.current &&
      requestSequence === adminRequestSequence.current &&
      isPlatformAuthSnapshotCurrent(authSnapshot);
    setAdmins([]);
    setLoading(true);
    setError("");
    try {
      const items = await listOrganizationAdmins(organizationId);
      if (isCurrentRequest()) setAdmins(items);
    } catch (reason) {
      if (isCurrentRequest()) {
        setError(errorMessage(reason, "机构管理员加载失败"));
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    const epoch = requestEpoch.current;
    const authSnapshot = getPlatformAuthSnapshot();
    const isCurrentRequest = () =>
      epoch === requestEpoch.current && isPlatformAuthSnapshotCurrent(authSnapshot);
    setLoading(true);
    setError("");
    try {
      const logs = await listPlatformAuditLogs();
      if (isCurrentRequest()) setAuditLogs(logs);
    } catch (reason) {
      if (isCurrentRequest()) setError(errorMessage(reason, "平台审计日志加载失败"));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  };

  useEffect(() => {
    if (!authenticated) return;
    const epoch = requestEpoch.current;
    const authSnapshot = getPlatformAuthSnapshot();
    const isCurrentRequest = () =>
      epoch === requestEpoch.current && isPlatformAuthSnapshotCurrent(authSnapshot);
    void getPlatformMe()
      .then((current) => {
        if (!isCurrentRequest()) return;
        setUser(current);
        if (!current.mustChangePassword) void loadOrganizations();
      })
      .catch((reason) => {
        if (!isCurrentRequest()) return;
        clearPlatformAuth();
        setLoginError(errorMessage(reason, "登录已失效，请重新登录"));
      });
  }, [authenticated, authRevision]);

  useEffect(() => {
    const handlePlatformAuthCleared = () => {
      invalidatePlatformUi();
      setAuthenticated(false);
    };
    const handlePlatformAuthStorage = (event: StorageEvent) => {
      if (event.key !== PLATFORM_AUTH_STORAGE_KEY) return;
      invalidatePlatformAuthSnapshots();
      invalidatePlatformUi();
      const latestAuth = getStoredPlatformAuth();
      if (!latestAuth?.accessToken) {
        setAuthenticated(false);
        setLoginError("登录状态已在其他标签页变更，请重新登录");
        return;
      }
      setLoginError("");
      setUser(latestAuth.account);
      setAuthenticated(true);
      setAuthRevision((current) => current + 1);
    };
    window.addEventListener(PLATFORM_AUTH_CLEARED_EVENT, handlePlatformAuthCleared);
    window.addEventListener("storage", handlePlatformAuthStorage);
    return () => {
      window.removeEventListener(PLATFORM_AUTH_CLEARED_EVENT, handlePlatformAuthCleared);
      window.removeEventListener("storage", handlePlatformAuthStorage);
    };
  }, []);

  useEffect(() => {
    if (authenticated && selectedOrganizationId) {
      void loadAdmins(selectedOrganizationId);
    } else {
      adminRequestSequence.current += 1;
      setAdmins([]);
    }
  }, [authenticated, selectedOrganizationId]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    const epoch = requestEpoch.current;
    setSubmitting(true);
    setLoginError("");
    try {
      const result = await loginPlatform(username.trim(), password);
      if (epoch !== requestEpoch.current) return;
      setUser(result.account);
      setPassword("");
      setAuthenticated(true);
    } catch (reason) {
      if (epoch === requestEpoch.current) setLoginError(errorMessage(reason, "登录失败"));
    } finally {
      if (epoch === requestEpoch.current) setSubmitting(false);
    }
  };

  const logout = async () => {
    await logoutPlatform().catch(() => undefined);
  };

  if (!authenticated) {
    return (
      <main className="login-page platform-login">
        <form className="login-card" onSubmit={(event) => void submitLogin(event)}>
          <p className="eyebrow">课宝平台管理中心</p>
          <h1>超级管理员登录</h1>
          <p className="platform-login-hint">仅供平台超级管理员使用</p>
          {loginError && <div className="load-error" role="alert">{loginError}</div>}
          <Field label="账号">
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="密码">
            <input
              required
              minLength={8}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "正在登录…" : "登录平台"}
          </button>
        </form>
      </main>
    );
  }

  if (user?.mustChangePassword) {
    return (
      <PlatformForcePasswordChange
        name={user.name}
        onChanged={() => void logout()}
        onLogout={() => void logout()}
      />
    );
  }

  const openOrganization = (item?: Organization) => {
    setOrganizationForm(item ? { code: item.code, name: item.name } : emptyOrganization);
    setDialog({ kind: "organization", ...(item ? { item } : {}) });
    setError("");
  };

  const openAdmin = (item?: OrganizationAdmin) => {
    setAdminForm(item ? {
      name: item.name,
      phone: item.phone ?? "",
      email: item.email ?? "",
    } : emptyAdmin);
    setDialog({ kind: "admin", ...(item ? { item } : {}) });
    setError("");
  };

  const selectOrganization = (organizationId: string) => {
    if (adminSubmissionInFlight.current) return;
    adminRequestSequence.current += 1;
    selectedOrganizationIdRef.current = organizationId;
    setSelectedOrganizationId(organizationId);
  };

  const submitOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "organization") return;
    const epoch = requestEpoch.current;
    const authSnapshot = getPlatformAuthSnapshot();
    const isCurrentRequest = () =>
      epoch === requestEpoch.current && isPlatformAuthSnapshotCurrent(authSnapshot);
    setSubmitting(true);
    setError("");
    try {
      await saveOrganization(
        { code: organizationForm.code.trim(), name: organizationForm.name.trim() },
        dialog.item?.id,
      );
      if (!isCurrentRequest()) return;
      setDialog(null);
      notify(dialog.item ? "机构信息已更新" : "机构已创建");
      await loadOrganizations();
    } catch (reason) {
      if (isCurrentRequest()) setError(errorMessage(reason, "机构保存失败"));
    } finally {
      if (isCurrentRequest()) setSubmitting(false);
    }
  };

  const submitAdmin = async (event: FormEvent) => {
    event.preventDefault();
    if (
      dialog?.kind !== "admin" ||
      !selectedOrganization ||
      adminSubmissionInFlight.current
    ) return;
    const authSnapshot = getPlatformAuthSnapshot();
    const organizationId = selectedOrganization.id;
    const requestSequence = adminRequestSequence.current;
    const submissionSequence = ++adminSubmissionSequence.current;
    const editingAdmin = dialog.item;
    const isCurrentRequest = () =>
      submissionSequence === adminSubmissionSequence.current &&
      requestSequence === adminRequestSequence.current &&
      selectedOrganizationIdRef.current === organizationId &&
      isPlatformAuthSnapshotCurrent(authSnapshot);
    adminSubmissionInFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      const saved = await saveOrganizationAdmin(
        organizationId,
        {
          name: adminForm.name.trim(),
          phone: adminForm.phone.trim(),
          email: adminForm.email.trim() || null,
        },
        editingAdmin?.id,
      );
      if (!isCurrentRequest()) return;
      if (!editingAdmin && saved.temporaryPassword) {
        setDialog({ kind: "temporary-password", value: saved.temporaryPassword });
      } else {
        setDialog(null);
        notify(editingAdmin ? "管理员信息已更新" : "管理员已创建");
      }
      await loadAdmins(organizationId);
    } catch (reason) {
      if (isCurrentRequest()) {
        setError(errorMessage(reason, "管理员保存失败"));
      }
    } finally {
      if (submissionSequence === adminSubmissionSequence.current) {
        adminSubmissionInFlight.current = false;
        if (isPlatformAuthSnapshotCurrent(authSnapshot)) setSubmitting(false);
      }
    }
  };

  const confirmAction = async (
    message: string,
    action: (isCurrentRequest: () => boolean) => Promise<unknown>,
  ) => {
    if (!window.confirm(message)) return;
    const epoch = requestEpoch.current;
    const authSnapshot = getPlatformAuthSnapshot();
    const isCurrentRequest = () =>
      epoch === requestEpoch.current && isPlatformAuthSnapshotCurrent(authSnapshot);
    setError("");
    try {
      await action(isCurrentRequest);
    } catch (reason) {
      if (isCurrentRequest()) setError(errorMessage(reason, "操作失败"));
    }
  };

  const resetAdminPassword = async (admin: OrganizationAdmin) => {
    if (!selectedOrganization || resetPasswordInFlight.current) return;
    if (!window.confirm(`确定重置「${admin.name}」的密码吗？`)) return;
    const authSnapshot = getPlatformAuthSnapshot();
    const organizationId = selectedOrganization.id;
    const requestSequence = adminRequestSequence.current;
    const isCurrentRequest = () =>
      requestSequence === adminRequestSequence.current &&
      isPlatformAuthSnapshotCurrent(authSnapshot);
    resetPasswordInFlight.current = true;
    setResettingAdminId(admin.id);
    setError("");
    try {
      const result = await resetOrganizationAdminPassword(organizationId, admin.id);
      if (isCurrentRequest()) {
        setDialog({ kind: "temporary-password", value: result.temporaryPassword });
        await loadAdmins(organizationId);
      }
    } catch (reason) {
      if (isCurrentRequest()) {
        setError(errorMessage(reason, "密码重置失败"));
      }
    } finally {
      if (requestSequence === adminRequestSequence.current) {
        resetPasswordInFlight.current = false;
        setResettingAdminId(null);
      }
    }
  };

  return (
    <div className="platform-shell">
      <header className="platform-header">
        <div>
          <p className="eyebrow">课宝平台管理中心</p>
          <h1>{view === "management" ? "超级管理员控制台" : "平台审计日志"}</h1>
        </div>
        <div className="platform-account">
          <span><b>{user?.name ?? "超级管理员"}</b><small>{user?.username}</small></span>
          <button
            className="secondary-button"
            onClick={() => {
              const next = view === "management" ? "audit" : "management";
              setView(next);
              if (next === "audit") void loadAuditLogs();
            }}
          >
            {view === "management" ? "审计日志" : "返回管理"}
          </button>
          <button className="secondary-button" onClick={() => setDialog({ kind: "change-password" })}>修改密码</button>
          <button className="secondary-button" onClick={() => void logout()}>退出登录</button>
        </div>
      </header>
      <main className="platform-main">
        {success && <div className="toast" role="status">{success}</div>}
        {error && <div className="load-error" role="alert">{error}</div>}
        {view === "audit" ? (
          <PlatformAuditView logs={auditLogs} loading={loading} onRefresh={loadAuditLogs} />
        ) : <>
        <section className="platform-organizations">
          <div className="section-heading compact">
            <div><h2>机构管理</h2><p>新增、编辑并控制机构服务状态</p></div>
            <button className="primary-button" onClick={() => openOrganization()}>新增机构</button>
          </div>
          {loading && organizations.length === 0 ? (
            <div className="table-state small">正在加载机构…</div>
          ) : organizations.length === 0 ? (
            <div className="table-state small"><strong>暂无机构</strong></div>
          ) : (
            <div className="organization-grid">
              {organizations.map((item) => (
                <article
                  key={item.id}
                  className={selectedOrganization?.id === item.id ? "organization-card active" : "organization-card"}
                >
                  <button
                    className="organization-select"
                    disabled={resettingAdminId !== null || submitting}
                    onClick={() => selectOrganization(item.id)}
                  >
                    <span><b>{item.name}</b><small>{item.code}</small></span>
                    <span className={item.isActive ? "status" : "status status-cancelled"}>
                      {item.isActive ? "已启用" : "已停用"}
                    </span>
                  </button>
                  <div className="organization-actions">
                    <button onClick={() => openOrganization(item)}>编辑</button>
                    <button onClick={() => void confirmAction(
                      `确定${item.isActive ? "停用" : "启用"}机构「${item.name}」吗？`,
                      async (isCurrentRequest) => {
                        await setOrganizationActive(item.id, !item.isActive);
                        if (isCurrentRequest()) await loadOrganizations();
                      },
                    )}>{item.isActive ? "停用" : "启用"}</button>
                    <button className="danger-link" onClick={() => void confirmAction(
                      `确定删除机构「${item.name}」吗？此操作不可撤销。`,
                      async (isCurrentRequest) => {
                        await deleteOrganization(item.id);
                        if (isCurrentRequest()) {
                          notify("机构已删除");
                          await loadOrganizations();
                        }
                      },
                    )}>删除</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="platform-admins">
          <div className="section-heading">
            <div>
              <h2>机构管理员</h2>
              <p>{selectedOrganization ? `当前机构：${selectedOrganization.name}` : "请先创建机构"}</p>
            </div>
            <button className="primary-button" disabled={!selectedOrganization} onClick={() => openAdmin()}>
              创建管理员
            </button>
          </div>
          {!selectedOrganization ? (
            <div className="table-state small">选择机构后查看管理员</div>
          ) : loading && admins.length === 0 ? (
            <div className="table-state small">正在加载管理员…</div>
          ) : admins.length === 0 ? (
            <div className="table-state small"><strong>暂无机构管理员</strong></div>
          ) : (
            <div className="table-card platform-table"><table>
              <thead><tr><th>管理员</th><th>手机号</th><th>状态</th><th>登录安全</th><th>操作</th></tr></thead>
              <tbody>{admins.map((admin) => (
                <tr key={admin.id}>
                  <td><b>{admin.name}</b><small>{admin.id}</small></td>
                  <td>{admin.phone}<small>{admin.email ?? "—"}</small></td>
                  <td><span className={admin.isActive ? "status" : "status status-cancelled"}>
                    {admin.isActive ? "已启用" : "已停用"}
                  </span></td>
                  <td>{admin.mustChangePassword ? "待修改临时密码" : "正常"}</td>
                  <td><div className="row-actions">
                    <button onClick={() => openAdmin(admin)}>编辑</button>
                    <button onClick={() => void confirmAction(
                      `确定${admin.isActive ? "停用" : "启用"}管理员「${admin.name}」吗？`,
                      async (isCurrentRequest) => {
                        await setOrganizationAdminActive(selectedOrganization.id, admin.id, !admin.isActive);
                        if (isCurrentRequest()) await loadAdmins(selectedOrganization.id);
                      },
                    )}>{admin.isActive ? "停用" : "启用"}</button>
                    <button
                      disabled={resettingAdminId !== null}
                      onClick={() => void resetAdminPassword(admin)}
                    >重置密码</button>
                    <button className="danger-link" onClick={() => void confirmAction(
                      `确定撤销「${admin.name}」的全部登录会话吗？`,
                      async (isCurrentRequest) => {
                        await revokeOrganizationAdminSessions(selectedOrganization.id, admin.id);
                        if (isCurrentRequest()) notify("管理员会话已撤销");
                      },
                    )}>撤销会话</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        </>}
      </main>
      {dialog?.kind === "organization" && (
        <Modal title={dialog.item ? "编辑机构" : "新增机构"} onClose={() => setDialog(null)}>
          <form onSubmit={(event) => void submitOrganization(event)}>
            <div className="form-grid">
              <Field label="机构编码"><input required maxLength={64} value={organizationForm.code} onChange={(event) => setOrganizationForm({ ...organizationForm, code: event.target.value })} /></Field>
              <Field label="机构名称"><input required maxLength={100} value={organizationForm.name} onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })} /></Field>
            </div>
            <DialogActions submitting={submitting} onCancel={() => setDialog(null)} />
          </form>
        </Modal>
      )}
      {dialog?.kind === "admin" && (
        <Modal
          title={dialog.item ? "编辑机构管理员" : "创建机构管理员"}
          closeDisabled={submitting}
          onClose={() => {
            if (!adminSubmissionInFlight.current) setDialog(null);
          }}
        >
          <form onSubmit={(event) => void submitAdmin(event)}>
            <div className="form-grid">
              <Field label="姓名"><input required maxLength={100} value={adminForm.name} onChange={(event) => setAdminForm({ ...adminForm, name: event.target.value })} /></Field>
              <Field label="手机号"><input required inputMode="tel" maxLength={32} value={adminForm.phone} onChange={(event) => setAdminForm({ ...adminForm, phone: event.target.value })} /></Field>
              <Field label="邮箱"><input type="email" maxLength={254} value={adminForm.email} onChange={(event) => setAdminForm({ ...adminForm, email: event.target.value })} /></Field>
            </div>
            <DialogActions submitting={submitting} onCancel={() => setDialog(null)} />
          </form>
        </Modal>
      )}
      {dialog?.kind === "temporary-password" && (
        <Modal title="临时密码" onClose={() => setDialog(null)}>
          <div className="temporary-password">
            <p>请立即复制并安全交付给管理员。关闭后将无法再次查看。</p>
            <code aria-label="临时密码值">{dialog.value}</code>
            <button className="primary-button" onClick={() => setDialog(null)}>我已保存，关闭</button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "change-password" && (
        <PasswordChangeDialog
          onClose={() => setDialog(null)}
          onChanged={() => {
            setDialog(null);
            void logout();
          }}
        />
      )}
    </div>
  );
}

function PlatformForcePasswordChange({
  name,
  onChanged,
  onLogout,
}: {
  name: string;
  onChanged: () => void;
  onLogout: () => void;
}) {
  return (
    <main className="login-page platform-login">
      <section className="login-card platform-password-card">
        <p className="eyebrow">账号安全</p>
        <h1>请先修改平台密码</h1>
        <p className="platform-login-hint">{name}，临时密码仅可用于首次登录。</p>
        <PasswordChangeForm
          onChanged={onChanged}
          actions={(submitting) => (
            <div className="platform-password-actions">
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? "正在修改…" : "修改密码"}
              </button>
              <button className="text-button" type="button" onClick={onLogout}>退出登录</button>
            </div>
          )}
        />
      </section>
    </main>
  );
}

function PasswordChangeDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  return <Modal title="修改平台密码" onClose={onClose}>
    <PasswordChangeForm
      onChanged={onChanged}
      actions={(submitting) => (
        <DialogActions submitting={submitting} onCancel={onClose} />
      )}
    />
  </Modal>;
}

function PasswordChangeForm({
  onChanged,
  actions,
}: {
  onChanged: () => void;
  actions: (submitting: boolean) => React.ReactNode;
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
    const authSnapshot = getPlatformAuthSnapshot();
    setSubmitting(true);
    setError("");
    try {
      await changePlatformPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      if (isPlatformAuthSnapshotCurrent(authSnapshot)) onChanged();
    } catch (reason) {
      if (isPlatformAuthSnapshotCurrent(authSnapshot)) {
        setError(errorMessage(reason, "密码修改失败"));
      }
    } finally {
      if (isPlatformAuthSnapshotCurrent(authSnapshot)) setSubmitting(false);
    }
  };
  return (
    <form className="password-change-form" onSubmit={(event) => void submit(event)}>
      {error && <div className="load-error" role="alert">{error}</div>}
      <div className="form-grid">
        <Field label="当前密码"><input required minLength={8} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
        <Field label="新密码"><input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
        <Field label="确认新密码"><input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
      </div>
      {actions(submitting)}
    </form>
  );
}

function PlatformAuditView({
  logs,
  loading,
  onRefresh,
}: {
  logs: PlatformAuditLog[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return <section className="platform-audit">
    <div className="section-heading compact">
      <div><h2>平台操作记录</h2><p>追踪机构及机构管理员的关键管理操作</p></div>
      <button className="secondary-button" onClick={onRefresh}>刷新</button>
    </div>
    {loading ? <div className="table-state small">正在加载审计日志…</div> :
      logs.length === 0 ? <div className="table-state small"><strong>暂无审计记录</strong></div> :
      <div className="table-card platform-table"><table>
        <thead><tr><th>时间</th><th>操作</th><th>操作人</th><th>对象</th><th>详情</th></tr></thead>
        <tbody>{logs.map((log) => <tr key={log.id}>
          <td><b>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(log.createdAt))}</b></td>
          <td><span className="audit-action">{platformAuditActionLabel[log.action] ?? log.action}</span></td>
          <td>{log.actorId}</td>
          <td><b>{log.entityType}</b><small>{log.entityId}</small></td>
          <td><code>{JSON.stringify(log.details)}</code></td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Modal({
  title,
  children,
  onClose,
  closeDisabled = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog-header"><h2>{title}</h2><button className="icon-button" aria-label="关闭" disabled={closeDisabled} onClick={onClose}>×</button></div>
      {children}
    </section>
  </div>;
}

function DialogActions({ submitting, onCancel }: { submitting: boolean; onCancel: () => void }) {
  return <div className="dialog-actions">
    <button className="secondary-button" type="button" disabled={submitting} onClick={onCancel}>取消</button>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "正在保存…" : "保存"}</button>
  </div>;
}
