"use client";

import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createUser, createOrganization, deleteUser, updateUserRole, updateUserAccess } from "@/lib/actions";
import { useClosePopover, useFloatingPosition, ConfirmDeleteButton } from "@/components/ui";
import { ownerInitials, ownerColor } from "@/lib/avatar";

type Role = "SUPER_ADMIN" | "ADMIN" | "INTERNAL";
type Access = "NONE" | "VIEW" | "EDIT";
type UserT = {
  id: string;
  email: string;
  name: string;
  role: Role;
  projectAccess: Access;
  roadmapAccess: Access;
  orgId: string;
  orgName: string;
  orgSlug: string;
  createdAt: string;
};
type Org = { id: string; name: string; slug: string };

const ROLE_META: Record<Role, { label: string; className: string }> = {
  SUPER_ADMIN: { label: "Super admin", className: "text-danger" },
  ADMIN: { label: "Admin", className: "text-accent" },
  INTERNAL: { label: "Internal", className: "text-text-muted" },
};

const ACCESS_META: Record<Access, { label: string; className: string }> = {
  NONE: { label: "No access", className: "text-text-muted" },
  VIEW: { label: "View only", className: "text-accent" },
  EDIT: { label: "Can edit", className: "text-success" },
};

function roleLegend(isSuperAdmin: boolean) {
  const legend: { role: Role; detail: string }[] = [
    { role: "ADMIN", detail: "Manages users and their access within their own organization; sees every board and roadmap there." },
    { role: "INTERNAL", detail: "Sees and edits only what their Project board / Roadmap board access levels allow. Cannot manage users." },
  ];
  if (isSuperAdmin) {
    legend.unshift({ role: "SUPER_ADMIN", detail: "Full access everywhere, across every organization. Only a super admin can grant this role." });
  }
  return legend;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

export default function UsersBoard({
  users,
  organizations,
  currentUserId,
  isSuperAdmin,
  homeOrgId,
}: {
  users: UserT[];
  organizations: Org[];
  currentUserId: string;
  isSuperAdmin: boolean;
  homeOrgId: string;
}) {
  const [creating, setCreating] = useState(false);
  const [addingOrg, setAddingOrg] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const dialogRef = useRef<HTMLDivElement>(null);
  const orgDialogRef = useRef<HTMLDivElement>(null);
  useClosePopover(creating, () => setCreating(false), dialogRef);
  useClosePopover(addingOrg, () => setAddingOrg(false), orgDialogRef);

  const visibleUsers = isSuperAdmin && orgFilter !== "all" ? users.filter((u) => u.orgId === orgFilter) : users;
  const admins = visibleUsers.filter((u) => u.role === "ADMIN").length;
  const superAdmins = users.filter((u) => u.role === "SUPER_ADMIN").length;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="figure text-xs text-text-muted">
            {visibleUsers.length} accounts · {admins} admin{admins === 1 ? "" : "s"}
            {isSuperAdmin ? ` · ${organizations.length} organization${organizations.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        {isSuperAdmin && (
          <>
            <select
              className="field h-9 w-48 py-0 text-sm"
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              aria-label="Filter by organization"
            >
              <option value="all">All organizations</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button className="btn-ghost" onClick={() => setAddingOrg(true)}>
              + Organization
            </button>
          </>
        )}
        <button className="btn-primary" onClick={() => setCreating(true)}>
          Add user
        </button>
      </header>
      <div className="animate-view-in flex-1 overflow-auto px-6 py-5">
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        {notice && <p className="mb-3 text-sm text-success">{notice}</p>}
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div
            className={`grid items-center border-b border-border bg-bg px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-text-muted ${
              isSuperAdmin
                ? "grid-cols-[1fr_1fr_140px_120px_120px_120px_100px_44px]"
                : "grid-cols-[1fr_1fr_140px_120px_120px_100px_44px]"
            }`}
          >
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            {isSuperAdmin && <span>Org</span>}
            <span>Project</span>
            <span>Roadmap</span>
            <span>Joined</span>
            <span />
          </div>
          {visibleUsers.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              lastAdmin={u.role === "ADMIN" && users.filter((x) => x.orgId === u.orgId && x.role === "ADMIN").length <= 1}
              lastSuperAdmin={u.role === "SUPER_ADMIN" && superAdmins <= 1}
              isSuperAdmin={isSuperAdmin}
              onError={setError}
            />
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border2 px-4 py-3 text-[13.5px] font-semibold">What each role can do</div>
          {roleLegend(isSuperAdmin).map((rl) => (
            <div key={rl.role} className="flex gap-3 border-b border-border2 px-4 py-2.5 last:border-b-0">
              <span
                className={`figure w-24 shrink-0 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${ROLE_META[rl.role].className}`}
              >
                {ROLE_META[rl.role].label}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-text-muted">{rl.detail}</span>
            </div>
          ))}
          <div className="flex gap-3 border-t border-border2 bg-bg px-4 py-2.5">
            <span className="figure w-24 shrink-0 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">
              Project / Roadmap
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-text-muted">
              Per-user, per-section access on top of role. No access hides the section entirely; view only removes every edit
              action; can edit is full read/write. Doesn&apos;t apply to super admins, who always have full access.
            </span>
          </div>
        </div>
      </div>

      {creating && (
        <div className="animate-overlay-in fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-user-title"
            className="animate-pop-in w-full max-w-[440px] rounded-2xl bg-surface shadow-2xl"
          >
            <NewUserForm
              onDone={() => setCreating(false)}
              onError={setError}
              isSuperAdmin={isSuperAdmin}
              organizations={organizations}
              homeOrgId={homeOrgId}
            />
          </div>
        </div>
      )}

      {addingOrg && (
        <div className="animate-overlay-in fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div
            ref={orgDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-org-title"
            className="animate-pop-in w-full max-w-[400px] rounded-2xl bg-surface shadow-2xl"
          >
            <NewOrgForm
              onDone={() => setAddingOrg(false)}
              onError={setError}
              onCreated={(slug) => setNotice(`Created. Their login link: /login?org=${slug}`)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AccessChip({
  userId,
  field,
  value,
  disabled,
  onError,
}: {
  userId: string;
  field: "projectAccess" | "roadmapAccess";
  value: Access;
  disabled: boolean;
  onError: (s: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, style } = useFloatingPosition(open, triggerRef);
  useClosePopover(open, () => setOpen(false), menuRef);

  if (disabled) {
    return <span className="figure text-xs text-text-muted">All access</span>;
  }

  const pick = (next: Access) => {
    setOpen(false);
    onError("");
    const prev = val;
    setVal(next);
    start(async () => {
      try {
        await updateUserAccess(userId, { [field]: next });
        router.refresh();
      } catch (err) {
        setVal(prev);
        onError(err instanceof Error ? err.message : "Failed to update access.");
      }
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`focus-ring flex w-full max-w-[104px] items-center justify-between gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-accent/40 disabled:opacity-60 ${ACCESS_META[val].className}`}
      >
        {ACCESS_META[val].label}
        <span className="text-text-muted">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={style}
            className="animate-pop-in z-20 w-32 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {(Object.keys(ACCESS_META) as Access[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pick(k)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface2 ${ACCESS_META[k].className}`}
              >
                {ACCESS_META[k].label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function RoleChip({
  user,
  lastAdmin,
  lastSuperAdmin,
  isSuperAdmin,
  onError,
}: {
  user: UserT;
  lastAdmin: boolean;
  lastSuperAdmin: boolean;
  isSuperAdmin: boolean;
  onError: (s: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(user.role);
  useEffect(() => setValue(user.role), [user.role]);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, style } = useFloatingPosition(open, triggerRef);
  useClosePopover(open, () => setOpen(false), menuRef);

  const locked = (value === "SUPER_ADMIN" && (lastSuperAdmin || !isSuperAdmin)) || (value === "ADMIN" && lastAdmin);
  const options: Role[] = isSuperAdmin ? ["INTERNAL", "ADMIN", "SUPER_ADMIN"] : ["INTERNAL", "ADMIN"];

  const pick = (next: Role) => {
    setOpen(false);
    onError("");
    const prev = value;
    setValue(next);
    start(async () => {
      try {
        await updateUserRole(user.id, next);
        router.refresh();
      } catch (err) {
        setValue(prev);
        onError(err instanceof Error ? err.message : "Failed to update role.");
      }
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Role"
        disabled={pending || locked}
        title={
          value === "SUPER_ADMIN" && !isSuperAdmin
            ? "Only a super admin can modify a super admin"
            : locked
              ? "At least one must remain"
              : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`focus-ring flex w-32 items-center justify-between gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:border-accent/40 disabled:opacity-60 disabled:hover:border-border ${ROLE_META[value].className}`}
      >
        {ROLE_META[value].label}
        <span className="text-text-muted">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={style}
            className="animate-pop-in z-20 w-32 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {options.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pick(k)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface2 ${ROLE_META[k].className}`}
              >
                {ROLE_META[k].label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function UserRow({
  user,
  isSelf,
  lastAdmin,
  lastSuperAdmin,
  isSuperAdmin,
  onError,
}: {
  user: UserT;
  isSelf: boolean;
  lastAdmin: boolean;
  lastSuperAdmin: boolean;
  isSuperAdmin: boolean;
  onError: (s: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const accessLocked = user.role === "SUPER_ADMIN";
  const canModify = isSuperAdmin || user.role !== "SUPER_ADMIN";

  const remove = () => {
    onError("");
    start(async () => {
      try {
        await deleteUser(user.id);
        router.refresh();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to delete user.");
      }
    });
  };

  return (
    <div
      className={`grid items-center border-b border-border/70 px-4 py-2.5 last:border-b-0 ${
        isSuperAdmin
          ? "grid-cols-[1fr_1fr_140px_120px_120px_120px_100px_44px]"
          : "grid-cols-[1fr_1fr_140px_120px_120px_100px_44px]"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="figure flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: ownerColor(user.name) }}
        >
          {ownerInitials(user.name)}
        </span>
        <span className="truncate text-sm font-medium">
          {user.name} {isSelf && <span className="text-xs text-text-muted">(you)</span>}
        </span>
      </div>
      <span className="truncate text-sm text-text-muted">{user.email}</span>
      <RoleChip user={user} lastAdmin={lastAdmin} lastSuperAdmin={lastSuperAdmin} isSuperAdmin={isSuperAdmin} onError={onError} />
      {isSuperAdmin && <span className="truncate text-xs text-text-muted">{user.orgName}</span>}
      <AccessChip userId={user.id} field="projectAccess" value={user.projectAccess} disabled={accessLocked || !canModify} onError={onError} />
      <AccessChip userId={user.id} field="roadmapAccess" value={user.roadmapAccess} disabled={accessLocked || !canModify} onError={onError} />
      <span className="figure text-xs text-text-muted">{fmtDate(user.createdAt)}</span>
      <div className="flex justify-end">
        <ConfirmDeleteButton
          variant="icon"
          label="✕"
          onConfirm={remove}
          disabled={pending || isSelf || lastAdmin || lastSuperAdmin || !canModify}
          title={
            isSelf
              ? "You cannot delete your own account"
              : !canModify
                ? "Only a super admin can delete a super admin"
                : lastSuperAdmin
                  ? "At least one super admin must remain"
                  : lastAdmin
                    ? "At least one admin must remain in this organization"
                    : "Delete user"
          }
        />
      </div>
    </div>
  );
}

function NewUserForm({
  onDone,
  onError,
  isSuperAdmin,
  organizations,
  homeOrgId,
}: {
  onDone: () => void;
  onError: (s: string) => void;
  isSuperAdmin: boolean;
  organizations: Org[];
  homeOrgId: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "INTERNAL" as Role,
    orgId: homeOrgId,
    projectAccess: "EDIT" as Access,
    roadmapAccess: "EDIT" as Access,
  });
  const [pending, start] = useTransition();

  const submit = () => {
    onError("");
    start(async () => {
      try {
        await createUser(form);
        router.refresh();
        onDone();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to create user.");
      }
    });
  };

  const roleOptions: Role[] = isSuperAdmin ? ["INTERNAL", "ADMIN", "SUPER_ADMIN"] : ["INTERNAL", "ADMIN"];

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 id="add-user-title" className="text-base font-semibold">Add user</h2>
        <button
          aria-label="Close"
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-bg"
          onClick={onDone}
        >
          ✕
        </button>
      </div>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
        {isSuperAdmin && organizations.length > 0 && (
          <div>
            <label className="mb-1 block text-[13px] font-medium">Organization</label>
            <select
              className="field"
              value={form.orgId}
              onChange={(e) => setForm({ ...form, orgId: e.target.value })}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-[13px] font-medium">Full name</label>
          <input
            autoFocus
            className="field"
            placeholder="e.g. Ayesha Raza"
            autoComplete="off"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium">Email</label>
          <input
            className="field"
            placeholder="name@company.com"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium">Temporary password</label>
          <input
            className="field"
            placeholder="At least 8 characters"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium">Role</label>
          <div className="flex flex-wrap gap-2">
            {roleOptions.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setForm({ ...form, role: r })}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  form.role === r ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted"
                }`}
              >
                {ROLE_META[r].label}
              </button>
            ))}
          </div>
        </div>
        {form.role !== "SUPER_ADMIN" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium">Project board</label>
              <select
                className="field"
                value={form.projectAccess}
                onChange={(e) => setForm({ ...form, projectAccess: e.target.value as Access })}
              >
                {(Object.keys(ACCESS_META) as Access[]).map((a) => (
                  <option key={a} value={a}>
                    {ACCESS_META[a].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium">Roadmap board</label>
              <select
                className="field"
                value={form.roadmapAccess}
                onChange={(e) => setForm({ ...form, roadmapAccess: e.target.value as Access })}
              >
                {(Object.keys(ACCESS_META) as Access[]).map((a) => (
                  <option key={a} value={a}>
                    {ACCESS_META[a].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <button className="btn-ghost" onClick={onDone} disabled={pending}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={submit}
          disabled={pending || !form.name.trim() || !form.email.trim() || form.password.length < 8}
        >
          {pending ? "Creating..." : "Create user"}
        </button>
      </div>
    </div>
  );
}

function NewOrgForm({
  onDone,
  onError,
  onCreated,
}: {
  onDone: () => void;
  onError: (s: string) => void;
  onCreated: (slug: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, start] = useTransition();

  const autoSlug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const submit = () => {
    onError("");
    start(async () => {
      try {
        const { slug: created } = await createOrganization(name, slug);
        router.refresh();
        onDone();
        onCreated(created);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to create organization.");
      }
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 id="add-org-title" className="text-base font-semibold">Add organization</h2>
        <button
          aria-label="Close"
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-bg"
          onClick={onDone}
        >
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <label className="mb-1 block text-[13px] font-medium">Company name</label>
          <input
            autoFocus
            className="field"
            placeholder="e.g. Acme Inc."
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(autoSlug(e.target.value));
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium">Login slug</label>
          <input
            className="field"
            placeholder="acme"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
          <p className="mt-1 text-xs text-text-muted">
            Their login link will be <span className="font-mono">/login?org={slug || "…"}</span>
          </p>
        </div>
        <p className="text-xs text-text-muted">Starts empty — a default board and roadmap, no data copied from any other org.</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
        <button className="btn-ghost" onClick={onDone} disabled={pending}>
          Cancel
        </button>
        <button className="btn-primary" onClick={submit} disabled={pending || !name.trim() || !slug.trim()}>
          {pending ? "Creating..." : "Create organization"}
        </button>
      </div>
    </div>
  );
}
