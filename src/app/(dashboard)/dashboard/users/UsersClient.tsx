"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  ShieldCheck,
  Ban,
  X,
  Check,
  UserCog,
  Users as UsersIcon,
  Handshake,
} from "lucide-react";
import { useT, useLocale } from "@/lib/i18n/I18nProvider";
import {
  PERMISSION_GROUPS,
  type PermissionGroup,
  type PermissionMap,
} from "@/lib/permissions";
import { MANAGED_ROLES, type UserDTO } from "@/lib/users";

const ROLE_ICON: Record<string, typeof UsersIcon> = {
  COMPANY_ADMIN: UserCog,
  STAFF: UsersIcon,
  PARTNER: Handshake,
};

type Tab = "STAFF" | "PARTNER" | "COMPANY_ADMIN";
const TABS: Tab[] = ["STAFF", "PARTNER", "COMPANY_ADMIN"];

interface FormState {
  name: string;
  email: string;
  phone: string;
  role: string;
  password: string;
  commissionRate: string;
}

const emptyForm = (): FormState => ({
  name: "",
  email: "",
  phone: "",
  role: "STAFF",
  password: "",
  commissionRate: "0",
});

const formFromUser = (u: UserDTO): FormState => ({
  name: u.name,
  email: u.email,
  phone: u.phone ?? "",
  role: u.role,
  password: "",
  commissionRate: String(u.commissionRate),
});

export default function UsersClient({
  initialUsers,
  currentUserId,
  canCreate,
}: {
  initialUsers: UserDTO[];
  currentUserId: string;
  canCreate: boolean;
}) {
  const tr = useT();
  const locale = useLocale();

  const [users, setUsers] = useState<UserDTO[]>(initialUsers);
  const [tab, setTab] = useState<Tab>("STAFF");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<UserDTO | null>(null);
  const [deactivating, setDeactivating] = useState<UserDTO | null>(null);
  const [error, setError] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        u.role === tab &&
        (!q || `${u.name} ${u.email}`.toLowerCase().includes(q))
    );
  }, [users, tab, search]);

  const upsert = (u: UserDTO) =>
    setUsers((prev) =>
      prev.some((x) => x.id === u.id)
        ? prev.map((x) => (x.id === u.id ? u : x))
        : [...prev, u]
    );

  const countOf = (role: Tab) =>
    users.filter((u) => u.role === role && u.isActive).length;

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("users.title")}</h1>
          <p className="dash-page-sub">{tr("users.subtitle")}</p>
        </div>
        {canCreate && (
          <button
            className="dash-btn dash-btn--primary"
            onClick={() => {
              setError("");
              setShowCreate(true);
            }}
          >
            <Plus size={17} /> {tr("users.addUser")}
          </button>
        )}
      </div>

      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("users.searchPlaceholder")}
          />
        </div>
        <div className="dash-filters">
          {TABS.map((t) => (
            <button
              key={t}
              className={`dash-filter ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
            >
              {tr(`users.tab${t}`)} ({countOf(t)})
            </button>
          ))}
        </div>
      </div>

      {error && <div className="dash-form-error">{error}</div>}

      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {tr(users.some((u) => u.role === tab) ? "users.emptyFiltered" : "users.empty")}
        </div>
      ) : (
        <div className="dash-users">
          {visible.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              tr={tr}
              locale={locale}
              isSelf={u.id === currentUserId}
              canManage={canCreate}
              onEdit={() => setEditing(u)}
              onPermissions={() => setPermissionsFor(u)}
              onDeactivate={() => setDeactivating(u)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <UserModal
          mode="create"
          tr={tr}
          onClose={() => setShowCreate(false)}
          onSaved={(u) => {
            upsert(u);
            setTab(u.role as Tab);
            setShowCreate(false);
          }}
        />
      )}

      {editing && (
        <UserModal
          mode="edit"
          user={editing}
          tr={tr}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            upsert(u);
            setEditing(null);
          }}
        />
      )}

      {permissionsFor && (
        <PermissionsModal
          user={permissionsFor}
          tr={tr}
          locale={locale}
          onClose={() => setPermissionsFor(null)}
          onSaved={(u) => {
            upsert(u);
            setPermissionsFor(null);
          }}
        />
      )}

      {deactivating && (
        <DeactivateModal
          user={deactivating}
          tr={tr}
          onClose={() => setDeactivating(null)}
          onDone={(u) => {
            upsert(u);
            setDeactivating(null);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Κάρτα χρήστη
   ───────────────────────────────────────────── */

function UserCard({
  user: u,
  tr,
  locale,
  isSelf,
  canManage,
  onEdit,
  onPermissions,
  onDeactivate,
}: {
  user: UserDTO;
  tr: (key: string) => string;
  locale: string;
  isSelf: boolean;
  canManage: boolean;
  onEdit: () => void;
  onPermissions: () => void;
  onDeactivate: () => void;
}) {
  const Icon = ROLE_ICON[u.role] ?? UsersIcon;
  const isAdmin = u.role === "COMPANY_ADMIN";

  return (
    <div className={`dash-user-card${u.isActive ? "" : " off"}`}>
      <div className="dash-user-card-icon">
        <Icon size={18} />
      </div>

      <div className="dash-user-card-main">
        <div className="dash-user-card-name">
          {u.name}
          {isSelf && <span className="dash-badge dash-badge--info">{tr("users.you")}</span>}
          {!u.isActive && (
            <span className="dash-badge dash-badge--muted">{tr("users.inactive")}</span>
          )}
        </div>
        <div className="dash-user-card-email">{u.email}</div>
        <div className="dash-user-card-perms">
          {isAdmin
            ? tr("users.adminAllPermissions")
            : `${u.permissionCount} ${tr("users.permissionsCount")}`}
          {u.role === "PARTNER" && (
            <>
              {" · "}
              {tr("users.commissionRate")}: <strong>{u.commissionRate}%</strong>
            </>
          )}
          {u.lastLoginAt && (
            <>
              {" · "}
              {tr("users.lastLogin")}:{" "}
              {new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "el-GR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              }).format(new Date(u.lastLoginAt))}
            </>
          )}
        </div>
      </div>

      {canManage && !isAdmin && (
        <div className="dash-user-card-actions">
          <button
            className="dash-btn"
            onClick={onPermissions}
            disabled={isSelf}
            title={isSelf ? tr("users.notYourself") : tr("users.permissions")}
          >
            <ShieldCheck size={16} /> {tr("users.permissions")}
          </button>
          <button
            className="dash-icon-btn"
            onClick={onEdit}
            title={tr("users.edit")}
            aria-label={tr("users.edit")}
          >
            <Pencil size={16} />
          </button>
          {u.isActive && (
            <button
              className="dash-icon-btn dash-icon-btn--danger"
              onClick={onDeactivate}
              disabled={isSelf}
              title={isSelf ? tr("users.notYourself") : tr("users.deactivate")}
              aria-label={tr("users.deactivate")}
            >
              <Ban size={16} />
            </button>
          )}
        </div>
      )}

      {canManage && isAdmin && (
        <div className="dash-user-card-actions">
          <span className="dash-badge dash-badge--ok">
            <ShieldCheck size={13} /> {tr("users.fullAccess")}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Δημιουργία / επεξεργασία
   ───────────────────────────────────────────── */

function UserModal({
  mode,
  user,
  tr,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  user?: UserDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onSaved: (u: UserDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(
    user ? formFromUser(user) : emptyForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<FormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    if (saving) return;

    if (!form.name.trim() || !form.email.trim()) {
      setError(tr("users.errorMissing"));
      return;
    }
    if (mode === "create" && form.password.length < 8) {
      setError(tr("users.errorPassword"));
      return;
    }
    if (mode === "edit" && form.password && form.password.length < 8) {
      setError(tr("users.errorPassword"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        role: form.role,
      };
      if (form.password) payload.password = form.password;
      if (form.role === "PARTNER") {
        payload.commissionRate = Math.min(
          100,
          Math.max(0, Number(form.commissionRate) || 0)
        );
      }

      const res = await fetch(
        mode === "create"
          ? "/api/company-users"
          : `/api/company-users/${user!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("users.errorSave"));
        return;
      }

      onSaved(data.data.user);
    } catch {
      setError(tr("users.errorConnection"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>{tr(mode === "create" ? "users.newUser" : "users.editUser")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("users.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <div className="dash-form-grid">
            <label className="dash-field dash-field--wide">
              {tr("users.name")}
              <input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            <label className="dash-field dash-field--wide">
              {tr("users.email")}
              <input
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </label>
            <label className="dash-field">
              {tr("users.phone")}
              <input
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </label>
            <label className="dash-field">
              {tr("users.category")}
              <select
                value={form.role}
                onChange={(e) => set({ role: e.target.value })}
              >
                {MANAGED_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tr(`users.tab${r}`)}
                  </option>
                ))}
              </select>
            </label>
            {form.role === "PARTNER" && (
              <label className="dash-field">
                {tr("users.commissionRate")}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  inputMode="decimal"
                  value={form.commissionRate}
                  onChange={(e) => set({ commissionRate: e.target.value })}
                />
              </label>
            )}
            <label className="dash-field dash-field--wide">
              {tr(mode === "create" ? "users.password" : "users.newPassword")}
              <input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={
                  mode === "edit" ? tr("users.passwordKeep") : undefined
                }
              />
            </label>
          </div>

          <p className="dash-form-note">
            {form.role === "PARTNER"
              ? tr("users.commissionNote")
              : tr("users.defaultsNote")}
          </p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>
            {tr("users.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? tr("users.saving") : tr("users.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Δικαιώματα
   ───────────────────────────────────────────── */

function PermissionsModal({
  user,
  tr,
  locale,
  onClose,
  onSaved,
}: {
  user: UserDTO;
  tr: (key: string) => string;
  locale: string;
  onClose: () => void;
  onSaved: (u: UserDTO) => void;
}) {
  const [granted, setGranted] = useState<PermissionMap>({
    ...user.permissions,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = (key: string) =>
    setGranted((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });

  const groupState = (group: PermissionGroup) => {
    const on = group.items.filter((i) => granted[i.key]).length;
    return { on, all: on === group.items.length, none: on === 0 };
  };

  const setGroup = (group: PermissionGroup, on: boolean) =>
    setGranted((prev) => {
      const next = { ...prev };
      for (const i of group.items) {
        if (on) next[i.key] = true;
        else delete next[i.key];
      }
      return next;
    });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/company-users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: Object.keys(granted) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("users.errorSave"));
        return;
      }

      onSaved(data.data.user);
    } catch {
      setError(tr("users.errorConnection"));
    } finally {
      setSaving(false);
    }
  };

  const total = Object.keys(granted).length;

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>
            {tr("users.permissionsOf")} {user.name}
          </h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("users.cancel")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <p className="dash-form-note dash-settings-lead">
            {tr("users.permissionsHelp")}
          </p>

          {PERMISSION_GROUPS.map((group) => {
            const state = groupState(group);
            return (
              <div key={group.id} className="dash-perm-group">
                <div className="dash-perm-head">
                  <span className="dash-perm-title">
                    {locale === "en" ? group.en : group.el}
                    {group.future && (
                      <span className="dash-soon">{tr("common.comingSoon")}</span>
                    )}
                  </span>
                  <button
                    className="dash-perm-all"
                    onClick={() => setGroup(group, !state.all)}
                  >
                    {state.all ? tr("users.selectNone") : tr("users.selectAll")}
                  </button>
                </div>

                <div className="dash-perm-items">
                  {group.items.map((item) => (
                    <label key={item.key} className="dash-perm-item">
                      <input
                        type="checkbox"
                        checked={granted[item.key] === true}
                        onChange={() => toggle(item.key)}
                      />
                      <span>
                        {locale === "en" ? item.en : item.el}
                        {item.future && !group.future && (
                          <span className="dash-soon">
                            {tr("common.comingSoon")}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <span className="dash-perm-count">
            {total} {tr("users.permissionsCount")}
          </span>
          <button className="dash-btn" onClick={onClose}>
            {tr("users.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={save}
            disabled={saving}
          >
            <Check size={16} />{" "}
            {saving ? tr("users.saving") : tr("users.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Απενεργοποίηση
   ───────────────────────────────────────────── */

function DeactivateModal({
  user,
  tr,
  onClose,
  onDone,
}: {
  user: UserDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onDone: (u: UserDTO) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError("");

    try {
      const res = await fetch(`/api/company-users/${user.id}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("users.errorSave"));
        return;
      }

      onDone(data.data.user);
    } catch {
      setError(tr("users.errorConnection"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div
        className="dash-modal dash-modal--sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dash-modal-header">
          <h2>{tr("users.confirmDeactivateTitle")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("users.cancel")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dash-modal-body">
          <p className="dash-confirm-vehicle">{user.name}</p>
          <p className="dash-form-note">{tr("users.confirmDeactivateBody")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>
        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose}>
            {tr("users.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--danger"
            onClick={run}
            disabled={busy}
          >
            {busy ? tr("users.saving") : tr("users.deactivate")}
          </button>
        </div>
      </div>
    </div>
  );
}
