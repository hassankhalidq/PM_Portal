"use client";

import { useEffect, useState, useTransition } from "react";
import { createUser, deleteUser, updateUserRole } from "@/lib/actions";

type Role = "ADMIN" | "INTERNAL";
type UserT = { id: string; email: string; name: string; role: Role; createdAt: string };

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

  useEffect(() => {
    if (!creating) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCreating(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [creating]);

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
      <div className="flex-1 overflow-auto px-6 py-5">
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="grid grid-cols-[1fr_1fr_140px_100px_44px] border-b border-border bg-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
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
      </div>

      {creating && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
          onClick={() => setCreating(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-user-title"
            className="w-full max-w-[440px] rounded-2xl bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <NewUserForm onDone={() => setCreating(false)} onError={setError} />
          </div>
        </div>
      )}
    </div>
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

  return (
    <div className="grid grid-cols-[1fr_1fr_140px_100px_44px] items-center border-b border-border/70 px-4 py-2.5 last:border-b-0">
      <span className="truncate text-sm font-medium">
        {user.name} {isSelf && <span className="text-xs text-text-muted">(you)</span>}
      </span>
      <span className="truncate text-sm text-text-muted">{user.email}</span>
      <select
        aria-label="Role"
        className="field w-32 text-xs"
        value={user.role}
        disabled={pending || lastAdmin}
        title={lastAdmin ? "At least one admin must remain" : undefined}
        onChange={(e) => {
          onError("");
          const role = e.target.value as Role;
          start(async () => {
            try {
              await updateUserRole(user.id, role);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Failed to update role.");
            }
          });
        }}
      >
        <option value="ADMIN">Admin</option>
        <option value="INTERNAL">Internal</option>
      </select>
      <span className="figure text-xs text-text-muted">{fmtDate(user.createdAt)}</span>
      <button
        aria-label="Delete user"
        className="btn-ghost h-7 w-7 justify-center p-0 text-danger"
        disabled={pending || isSelf || lastAdmin}
        title={
          isSelf
            ? "You cannot delete your own account"
            : lastAdmin
              ? "At least one admin must remain"
              : "Delete user"
        }
        onClick={() => {
          if (!confirm(`Delete ${user.name}? Their comments will also be removed.`)) return;
          onError("");
          start(async () => {
            try {
              await deleteUser(user.id);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Failed to delete user.");
            }
          });
        }}
      >
        ✕
      </button>
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
            placeholder="name@sahulatpay.com"
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
          <select
            className="field"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            <option value="INTERNAL">Internal</option>
            <option value="ADMIN">Admin</option>
          </select>
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
