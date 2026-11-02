import type { FormHTMLAttributes, HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppModal.css";

export function MiniAppModalBackdrop({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={classNames("mini-app-modal-backdrop", className)}
    />
  );
}

export function MiniAppModalPanel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-modal-panel", className)} />
  );
}

export function MiniAppModalForm({
  className,
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form {...props} className={classNames("mini-app-modal-form", className)} />
  );
}

/**
 * Covers the whole modal panel while its action runs, so the busy state reads
 * as the dialog's rather than one button's, and the form underneath cannot be
 * edited mid-flight. Render it as the panel's last child.
 */
export function MiniAppModalBusyOverlay({ label }: { label: string }) {
  return (
    <div className="mini-app-modal-busy" role="status" aria-live="polite">
      <span className="mini-app-modal-busy-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
