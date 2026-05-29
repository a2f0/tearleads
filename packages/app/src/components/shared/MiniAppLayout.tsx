import type {
  ButtonHTMLAttributes,
  FormHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef } from "react";
import { classNames } from "./classNames";
import "./MiniAppLayout.css";

type MiniAppRootPadding = "normal" | "none";
type MiniAppStatusTone = "muted" | "error";

export function MiniAppRoot({
  centered = false,
  className,
  padding = "normal",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  centered?: boolean | undefined;
  padding?: MiniAppRootPadding | undefined;
}) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-root",
        padding !== "normal" && `mini-app-root--padding-${padding}`,
        centered && "mini-app-root--centered",
        className,
      )}
    />
  );
}

export function MiniAppSidebar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-sidebar", className)} />
  );
}

export function MiniAppToolbar({
  className,
  wrap = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  wrap?: boolean | undefined;
}) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-toolbar",
        wrap && "mini-app-toolbar--wrap",
        className,
      )}
    />
  );
}

export function MiniAppActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-actions", className)} />
  );
}

export function MiniAppHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-header", className)} />
  );
}

export function MiniAppHeaderCopy({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={classNames("mini-app-header-copy", className)} />
  );
}

export function MiniAppPanel({
  className,
  scroll = false,
  variant = "plain",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  scroll?: boolean | undefined;
  variant?: "plain" | "framed" | undefined;
}) {
  return (
    <div
      {...props}
      className={classNames(
        "mini-app-panel",
        scroll && "mini-app-panel--scroll",
        variant !== "plain" && `mini-app-panel--${variant}`,
        className,
      )}
    />
  );
}

export function MiniAppFormPanel({
  className,
  scroll = false,
  variant = "plain",
  ...props
}: FormHTMLAttributes<HTMLFormElement> & {
  scroll?: boolean | undefined;
  variant?: "plain" | "framed" | undefined;
}) {
  return (
    <form
      {...props}
      className={classNames(
        "mini-app-panel",
        scroll && "mini-app-panel--scroll",
        variant !== "plain" && `mini-app-panel--${variant}`,
        className,
      )}
    />
  );
}

export function MiniAppSection({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={classNames("mini-app-section", className)} />
  );
}

export function MiniAppSectionHeading({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={classNames("mini-app-section-heading", className)}
    />
  );
}

export function MiniAppInfoHeading({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      {...props}
      className={classNames("mini-app-info-section-heading", className)}
    />
  );
}

export function MiniAppInfoSection({
  children,
  className,
  heading,
  ...props
}: HTMLAttributes<HTMLElement> & {
  heading?: ReactNode | undefined;
}) {
  return (
    <section
      {...props}
      className={classNames("mini-app-info-section", className)}
    >
      {heading ? <MiniAppInfoHeading>{heading}</MiniAppInfoHeading> : null}
      {children}
    </section>
  );
}

export function MiniAppButton({
  block = false,
  className,
  type = "button",
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  block?: boolean | undefined;
  variant?: "default" | "ghost" | undefined;
}) {
  return (
    <button
      {...props}
      className={classNames(
        "mini-app-button",
        block && "mini-app-button--block",
        variant !== "default" && `mini-app-button--${variant}`,
        className,
      )}
      type={type}
    />
  );
}

export const MiniAppInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function MiniAppInput({ className, ...props }, ref) {
  return (
    <input
      {...props}
      className={classNames("mini-app-input", className)}
      ref={ref}
    />
  );
});

export const MiniAppSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function MiniAppSelect({ className, ...props }, ref) {
  return (
    <select
      {...props}
      className={classNames("mini-app-select", className)}
      ref={ref}
    />
  );
});

export const MiniAppTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function MiniAppTextarea({ className, ...props }, ref) {
  return (
    <textarea
      {...props}
      className={classNames("mini-app-textarea", className)}
      ref={ref}
    />
  );
});

export function MiniAppField({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Callers render the concrete control as children.
    <label {...props} className={classNames("mini-app-field", className)} />
  );
}

export function MiniAppStatus({
  as = "div",
  className,
  tone = "muted",
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: "div" | "span" | undefined;
  tone?: MiniAppStatusTone | undefined;
}) {
  const Component = as;

  return (
    <Component
      {...props}
      className={classNames(
        "mini-app-status",
        tone !== "muted" && `mini-app-status--${tone}`,
        className,
      )}
    />
  );
}

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
