"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useTransition } from "react";
import { createUser, deleteUser, updateUserRole } from "@/lib/actions";
import { useClosePopover, useFloatingPosition, ConfirmDeleteButton } from "@/components/ui";
import { ownerInitials, ownerColor } from "@/lib/avatar";

type Role = "ADMIN" | "INTERNAL";
type UserT = { id: string; email: string; name: string; role: Role; createdAt: string };

const ROLE_META: Record<Role, { label: string; className: string }> = {
  ADMIN: { label: "Admin", className: "text-accent" },
  INTERNAL: { label: "Internal", className: "text-text-muted" },
};

const ROLE_LEGEND: { role: Role; detail: string }[] = [
  { role: "ADMIN", detail: "Full control: manage users and roles, and access every board and roadmap." },
  { role: "INTERNAL", detail: "Create and edit items across boards and roadmaps. Cannot manage users." },
];

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

export default function UsersBoard({
  users,
  currentUserId,
}: {
  users: UserT[];
  currentUserId: string;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const admins = users.filter((u) => u.role === "ADMIN").length;
  const dialogRef = useRef<HTMLDivElement>(null);
  useClosePopover(creating, () => setCreating(false), dialogRef);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-6 py-4">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="figure text-xs text-text-muted">
            {users.length} accounts · {admins} admin{admins === 1 ? "" : "s"}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          Add user
        </button>
      </header>
      <div className="animate-view-in flex-1 overflow-auto px-6 py-5">
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="grid grid-cols-[1fr_1fr_140px_100px_44px] border-b border-border bg-bg px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Joined</span>
            <span />
          </div>
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              lastAdmin={u.role === "ADMIN" && admins <= 1}
              onError={setError}
            />
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border2 px-4 py-3 text-[13.5px] font-semibold">What each role can do</div>
          {ROLE_LEGEND.map((rl) => (
            <div key={rl.role} className="flex gap-3 border-b border-border2 px-4 py-2.5 last:border-b-0">
              <span
                className={`figure w-16 shrink-0 pt-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${ROLE_META[rl.role].className}`}
              >
                {ROLE_META[rl.role].label}
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-text-muted">{rl.detail}</span>
            </div>
          ))}
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
            <NewUserForm onDone={() => setCreating(false)} onError={setError} />
          </div>
        </div>
      )}
    </div>
  );
}

function RoleChip({
  user,
  lastAdmin,
  onError,
}: {
  user: UserT;
  lastAdmin: boolean;
  onError: (s: string) => void;
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(user.role);
  useEffect(() => setValue(user.role), [user.role]);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { menuRef, style } = useFloatingPosition(open, triggerRef);
  useClosePopover(open, () => setOpen(false), menuRef);

  const pick = (next: Role) => {
    setOpen(false);
    onError("");
    const prev = value;
    setValue(next);
    start(async () => {
      try {
        await updateUserRole(user.id, next);
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
        disabled={pending || lastAdmin}
        title={lastAdmin ? "At least one admin must remain" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`focus-ring flex w-28 items-center justify-between gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:border-accent/40 disabled:opacity-60 disabled:hover:border-border ${ROLE_META[value].className}`}
      >
        {ROLE_META[value].label}
        <span className="text-text-muted">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={style}
            className="animate-pop-in z-20 w-28 rounded-lg border border-border bg-surface p-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {(Object.keys(ROLE_META) as Role[]).map((k) => (
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
  onError,
}: {
  user: UserT;
  isSelf: boolean;
  lastAdmin: boolean;
  onError: (s: string) => void;
}) {
  const [pending, start] = useTransition();

  const remove = () => {
    onError("");
    start(async () => {
      try {
        await deleteUser(user.id);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to delete user.");
      }
    });
  };

  return (
    <div className="grid grid-cols-[1fr_1fr_140px_100px_44px] items-center border-b border-border/70 px-4 py-2.5 last:border-b-0">
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
      <RoleChip user={user} lastAdmin={lastAdmin} onError={onError} />
      <span className="figure text-xs text-text-muted">{fmtDate(user.createdAt)}</span>
      <div className="flex justify-end">
        <ConfirmDeleteButton
          variant="icon"
          label="✕"
          onConfirm={remove}
          disabled={pending || isSelf || lastAdmin}
          title={
            isSelf
              ? "You cannot delete your own account"
              : lastAdmin
                ? "At least one admin must remain"
                : "Delete user"
          }
        />
      </div>
    </div>
  );
}

function NewUserForm({ onDone, onError }: { onDone: () => void; onError: (s: string) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "INTERNAL" as Role });
  const [pending, start] = useTransition();

  const submit = () => {
    onError("");
    start(async () => {
      try {
        await createUser(form);
        onDone();
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to create user.");
      }
    });
  };

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
      <div className="flex flex-col gap-4 p-5">
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
          <div className="flex gap-2">
            {(["INTERNAL", "ADMIN"] as Role[]).map((r) => (
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
