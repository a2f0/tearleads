import type { PropsWithChildren, ReactNode } from "react";
import { classNames } from "./classNames";
import "./styles.css";

export interface TearleadsHeaderProps {
  readonly actions?: ReactNode;
  readonly brandHref?: string | undefined;
  readonly brandLabel?: string | undefined;
}

export function TearleadsHeader({
  actions,
  brandHref,
  brandLabel = "Tearleads",
}: TearleadsHeaderProps) {
  const brand = <span className="tearleads-brand-mark">{brandLabel}</span>;

  return (
    <header className="tearleads-header">
      {brandHref ? (
        <a className="tearleads-brand" href={brandHref}>
          {brand}
        </a>
      ) : (
        <div className="tearleads-brand">{brand}</div>
      )}
      {actions && <div className="tearleads-header-actions">{actions}</div>}
    </header>
  );
}

export interface TearleadsFooterProps {
  readonly end?: ReactNode;
  readonly start?: ReactNode;
}

export function TearleadsFooter({ end, start }: TearleadsFooterProps) {
  return (
    <footer className="tearleads-footer">
      {start && <div className="tearleads-footer-start">{start}</div>}
      {end && <div className="tearleads-footer-end">{end}</div>}
    </footer>
  );
}

export interface TearleadsFrameProps extends PropsWithChildren {
  readonly brandHref?: string | undefined;
  readonly brandLabel?: string | undefined;
  readonly className?: string | undefined;
  readonly footerEnd?: ReactNode;
  readonly footerStart?: ReactNode;
  readonly headerActions?: ReactNode;
}

export function TearleadsFrame({
  brandHref,
  brandLabel,
  children,
  className,
  footerEnd,
  footerStart,
  headerActions,
}: TearleadsFrameProps) {
  return (
    <div className={classNames("tearleads-frame", className)}>
      <TearleadsHeader
        actions={headerActions}
        brandHref={brandHref}
        brandLabel={brandLabel}
      />
      {children}
      <TearleadsFooter end={footerEnd} start={footerStart} />
    </div>
  );
}
