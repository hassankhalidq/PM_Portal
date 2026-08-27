"use client";

import { useEffect, useRef, useState } from "react";

export function useClosePopover(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, ref]);
}

export function ConfirmDeleteButton({
  label = "Delete",
  onConfirm,
  disabled,
  title,
  ariaLabel,
  variant = "button",
}: {
  label?: string;
  onConfirm: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  // "icon" is for a compact square icon-button slot (e.g. next to ↑/↓ move
  // buttons) — same arm-then-confirm behavior, but the armed state can't
  // grow to fit "Confirm delete" text, so it swaps to a warning glyph and
  // relies on the tooltip instead.
  variant?: "button" | "icon";
}) {
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClosePopover(armed, () => setArmed(false), ref);
  const click = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onConfirm();
  };
  if (variant === "icon") {
    return (
      <div ref={ref} className="inline-block">
        <button
          type="button"
          disabled={disabled}
          onClick={click}
          title={armed ? "Click again to confirm" : title}
          aria-label={armed ? "Click again to confirm delete" : ariaLabel ?? title}
          className={`btn-ghost h-7 w-7 justify-center p-0 ${
            armed ? "border-danger bg-danger text-white" : "text-danger"
          }`}
        >
          {armed ? "!" : label}
        </button>
      </div>
    );
  }
  return (
    <div ref={ref} className="inline-block">
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={click}
        className={`btn ${
          armed ? "border border-danger bg-danger text-white hover:bg-danger" : "btn-ghost text-danger"
        }`}
      >
        {armed ? "Confirm delete" : label}
      </button>
    </div>
  );
}
