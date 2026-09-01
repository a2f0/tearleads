import type { PropsWithChildren, ReactNode } from "react";
import { classNames } from "./classNames";
import "./styles.css";
// Touch/routed-layout overrides; must load after styles.css (see that file).
import "./styles.routed.css";
// Base anchor reset, shared by every shell (see that file).
import "./styles.links.css";

export interface TearleadsHeaderProps {
  readonly actions?: ReactNode;
  readonly brandHref?: string | undefined;
  readonly brandLabel?: string | undefined;
  readonly brandLogo?: ReactNode;
}

export function TearleadsHeader({
  actions,
  brandHref,
  brandLabel = "Tearleads",
  brandLogo,
}: TearleadsHeaderProps) {
  const brand = (
    <>
      {brandLogo && <span className="tearleads-brand-logo">{brandLogo}</span>}
      <span className="tearleads-brand-mark">{brandLabel}</span>
    </>
  );

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
  if (!start && !end) {
    return null;
  }

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
  readonly brandLogo?: ReactNode;
  readonly className?: string | undefined;
  readonly footerEnd?: ReactNode;
  readonly footerStart?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly showHeader?: boolean | undefined;
}

export function TearleadsFrame({
  brandHref,
  brandLabel,
  brandLogo,
  children,
  className,
  footerEnd,
  footerStart,
  headerActions,
  showHeader = true,
}: TearleadsFrameProps) {
  return (
    <div className={classNames("tearleads-frame", className)}>
      {showHeader && (
        <TearleadsHeader
          actions={headerActions}
          brandHref={brandHref}
          brandLabel={brandLabel}
          brandLogo={brandLogo}
        />
      )}
      {children}
      <TearleadsFooter end={footerEnd} start={footerStart} />
    </div>
  );
}
