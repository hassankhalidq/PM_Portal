"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

type Entity = { id: string; name: string; description?: string; isDefault: boolean };

export default function EntitySwitcher({
  label,
  entities,
  currentId,
  paramName,
  basePath,
  actions,
}: {
  label: string;
  entities: Entity[];
  currentId: string;
  paramName: "board" | "roadmap";
  basePath: "/projects" | "/roadmap";
  actions: {
    create: (name: string) => Promise<{ id: string }>;
    rename: (id: string, name: string, description?: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const current = entities.find((e) => e.id === currentId);

  const closeAll = () => {
    setOpen(false);
    setCreating(false);
    setRenamingId(null);
    setError("");
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeAll();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const select = (id: string) => {
    setOpen(false);
    router.push(`${basePath}?${paramName}=${id}`);
  };

  const submitCreate = () => {
    const clean = newName.trim();
    if (!clean) return;
    setError("");
    start(async () => {
      try {
        const { id } = await actions.create(clean);
        setNewName("");
        setCreating(false);
        setOpen(false);
        router.push(`${basePath}?${paramName}=${id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create.");
      }
    });
  };

  const submitRename = (id: string) => {
    const clean = renameValue.trim();
    if (!clean) return;
    setError("");
    start(async () => {
      try {
        await actions.rename(id, clean, renameDescription);
        setRenamingId(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to rename.");
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm(`Delete this ${label.toLowerCase()}? Everything inside it will be removed too.`)) return;
    setError("");
    start(async () => {
      try {
        await actions.remove(id);
        if (id === currentId) {
          const fallback = entities.find((e) => e.id !== id);
          if (fallback) router.push(`${basePath}?${paramName}=${fallback.id}`);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete.");
      }
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}>
        {current?.name ?? label}
        <span className="text-text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg">
          {error && <p className="px-2 pb-1 text-xs text-danger">{error}</p>}
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {entities.map((e) => (
              <div
                key={e.id}
                className={`group flex gap-1 rounded-lg px-2 py-1.5 text-sm ${
                  renamingId === e.id ? "items-start" : "items-center"
                } ${e.id === currentId ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}
              >
                {renamingId === e.id ? (
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        className="field h-7 flex-1 px-2 py-0 text-xs"
                        value={renameValue}
                        onChange={(ev) => setRenameValue(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") submitRename(e.id);
                          if (ev.key === "Escape") setRenamingId(null);
                        }}
                        disabled={pending}
                      />
                      <button
                        aria-label="Confirm rename"
                        title="Save"
                        className="shrink-0 text-text-muted hover:text-accent disabled:opacity-30"
                        onClick={() => submitRename(e.id)}
                        disabled={pending}
                      >
                        ✓
                      </button>
                      <button
                        aria-label="Cancel rename"
                        title="Cancel"
                        className="shrink-0 text-text-muted hover:text-danger"
                        onClick={() => setRenamingId(null)}
                        disabled={pending}
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      className="field h-12 resize-none px-2 py-1 text-xs"
                      placeholder="Description (shown on the Dashboard)"
                      value={renameDescription}
                      onChange={(ev) => setRenameDescription(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Escape") setRenamingId(null);
                      }}
                      disabled={pending}
                    />
                  </div>
                ) : (
                  <>
                    <button className="min-w-0 flex-1 truncate text-left" onClick={() => select(e.id)}>
                      {e.name}
                    </button>
                    <button
                      aria-label={`Rename ${e.name}`}
                      title="Rename"
                      className="shrink-0 text-text-muted opacity-0 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                      onClick={() => {
                        setRenamingId(e.id);
                        setRenameValue(e.name);
                        setRenameDescription(e.description ?? "");
                      }}
                    >
                      ✎
                    </button>
                    <button
                      aria-label={`Delete ${e.name}`}
                      title={entities.length <= 1 ? `At least one ${label.toLowerCase()} must exist` : "Delete"}
                      disabled={entities.length <= 1 || pending}
                      className="shrink-0 text-text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-30"
                      onClick={() => remove(e.id)}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            {creating ? (
              <div className="flex items-center gap-1 px-1 py-1">
                <input
                  autoFocus
                  className="field h-8 flex-1 px-2 py-0 text-xs"
                  placeholder={`New ${label.toLowerCase()} name`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCreate();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  disabled={pending}
                />
                <button className="btn-primary h-8 px-2 py-0 text-xs" onClick={submitCreate} disabled={pending}>
                  {pending ? "Adding…" : "Add"}
                </button>
              </div>
            ) : (
              <button
                className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-accent hover:bg-bg"
                onClick={() => setCreating(true)}
              >
                + New {label.toLowerCase()}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
