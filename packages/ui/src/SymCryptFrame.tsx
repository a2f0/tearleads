import type { PropsWithChildren, ReactNode } from "react";
import { classNames } from "./classNames";
import "./styles.css";
// Touch/routed-layout overrides; must load after styles.css (see that file).
import "./styles.routed.css";
// Base anchor reset, shared by every shell (see that file).
import "./styles.links.css";

export interface SymCryptHeaderProps {
  readonly actions?: ReactNode;
  readonly brandHref?: string | undefined;
  readonly brandLabel?: string | undefined;
  readonly brandLogo?: ReactNode;
}

export function SymCryptHeader({
  actions,
  brandHref,
  brandLabel = "SymCrypt",
  brandLogo,
}: SymCryptHeaderProps) {
  const brand = (
    <>
      {brandLogo && <span className="symcrypt-brand-logo">{brandLogo}</span>}
      <span className="symcrypt-brand-mark">{brandLabel}</span>
    </>
  );

  return (
    <header className="symcrypt-header">
      {brandHref ? (
        <a className="symcrypt-brand" href={brandHref}>
          {brand}
        </a>
      ) : (
        <div className="symcrypt-brand">{brand}</div>
      )}
      {actions && <div className="symcrypt-header-actions">{actions}</div>}
    </header>
  );
}

export interface SymCryptFooterProps {
  readonly end?: ReactNode;
  readonly start?: ReactNode;
}

export function SymCryptFooter({ end, start }: SymCryptFooterProps) {
  if (!start && !end) {
    return null;
  }

  return (
    <footer className="symcrypt-footer">
      {start && <div className="symcrypt-footer-start">{start}</div>}
      {end && <div className="symcrypt-footer-end">{end}</div>}
    </footer>
  );
}

export interface SymCryptFrameProps extends PropsWithChildren {
  readonly brandHref?: string | undefined;
  readonly brandLabel?: string | undefined;
  readonly brandLogo?: ReactNode;
  readonly className?: string | undefined;
  readonly footerEnd?: ReactNode;
  readonly footerStart?: ReactNode;
  readonly headerActions?: ReactNode;
  readonly showHeader?: boolean | undefined;
}

export function SymCryptFrame({
  brandHref,
  brandLabel,
  brandLogo,
  children,
  className,
  footerEnd,
  footerStart,
  headerActions,
  showHeader = true,
}: SymCryptFrameProps) {
  return (
    <div className={classNames("symcrypt-frame", className)}>
      {showHeader && (
        <SymCryptHeader
          actions={headerActions}
          brandHref={brandHref}
          brandLabel={brandLabel}
          brandLogo={brandLogo}
        />
      )}
      {children}
      <SymCryptFooter end={footerEnd} start={footerStart} />
    </div>
  );
}
