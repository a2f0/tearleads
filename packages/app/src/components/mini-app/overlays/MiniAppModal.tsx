import type { FormHTMLAttributes, HTMLAttributes } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppModal.css";

/**
 * What a modal covers and what it stacks above:
 * - `section` covers its nearest positioned ancestor (a window's content
 *   section, or the routed shell) and stays below the window's menus.
 * - `raised` covers the same region above window menus and shell chrome.
 * - `viewport` covers the whole screen, for a dialog portaled to the body.
 */
type MiniAppModalLayer = "section" | "raised" | "viewport";

/**
 * Blocks the region the modal covers. By default the modal takes that region
 * over with an opaque surface, so the blocked content is hidden and the
 * dialog's panel gets all of the space. `floating` instead dims the region and
 * centers a framed panel over it; only a viewer that sizes its own frame
 * should ask for it, and it passes `floating` to its panel too.
 */
export function MiniAppModalBackdrop({
  className,
  floating = false,
  layer = "section",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  floating?: boolean;
  layer?: MiniAppModalLayer;
}) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-modal-backdrop",
        floating
          ? "mini-app-modal-backdrop--floating"
          : "mini-app-modal-backdrop--takeover",
        layer !== "section" && `mini-app-modal-backdrop--${layer}`,
        className,
      )}
    />
  );
}

/**
 * The dialog itself. It fills its backdrop and lays its content out in one
 * readable column, centered while it fits and scrolling once it does not;
 * `floating` pairs it with a floating backdrop as a framed panel instead.
 */
export function MiniAppModalPanel({
  className,
  floating = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { floating?: boolean }) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-modal-panel",
        floating
          ? "mini-app-modal-panel--floating"
          : "mini-app-modal-panel--takeover",
        className,
      )}
    />
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
 * Sets a runtime value apart from a modal's copy: the phrase a confirmation
 * asks the user to type, or the name of what the action will change.
 */
export function MiniAppModalHighlight({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={classNames("mini-app-modal-highlight", className)}
    />
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
