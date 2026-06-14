import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../shared/classNames";
import "./MiniAppSection.css";

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
