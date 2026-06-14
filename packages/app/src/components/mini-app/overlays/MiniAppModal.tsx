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
