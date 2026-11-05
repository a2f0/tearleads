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
 * Replaces the whole modal panel while its action runs: an in-flight action
 * cannot be cancelled, so the form gives way to one centered spinner, title,
 * and optional description rather than a spinner inside the submit button.
 * Render it as the panel's last child, and set the busy flag through
 * `runAfterBusyPaint()` before starting main-thread work so the ring has
 * painted and keeps turning on the compositor.
 */
export function MiniAppModalBusyOverlay({
  description,
  label,
}: {
  description?: string | undefined;
  label: string;
}) {
  return (
    <div className="mini-app-modal-busy" role="status" aria-live="polite">
      <span className="mini-app-modal-busy-spinner" aria-hidden="true" />
      <span className="mini-app-modal-busy-title">{label}</span>
      {description ? (
        <span className="mini-app-modal-busy-description">{description}</span>
      ) : null}
    </div>
  );
}
