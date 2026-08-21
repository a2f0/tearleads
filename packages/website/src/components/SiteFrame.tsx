import { SymCryptFrame, SymCryptLogo } from "@symcrypt/ui";
import type { PropsWithChildren, ReactNode } from "react";

interface SiteFrameProps {
  readonly appUrl: string;
  // The primary nav, supplied by the layout as its own hydrated island (a
  // Astro slot="nav"), so only the nav ships client JS and the frame — header,
  // footer, and slotted page content — stays fully static.
  readonly nav?: ReactNode;
}

const FOOTER_ITEMS: readonly {
  readonly href: string;
  readonly label: string;
}[] = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-of-service", label: "Terms of Service" },
];

function FooterLinks() {
  return (
    <nav aria-label="Legal" className="site-footer-links">
      {FOOTER_ITEMS.map((item) => (
        <a className="site-footer-link" href={item.href} key={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function SiteFrame({
  appUrl,
  children,
  nav,
}: PropsWithChildren<SiteFrameProps>) {
  return (
    <SymCryptFrame
      brandHref="/"
      brandLogo={<SymCryptLogo />}
      footerStart={<FooterLinks />}
      headerActions={
        <>
          {nav}
          <a className="symcrypt-action-button site-app-button" href={appUrl}>
            App
          </a>
        </>
      }
    >
      {children}
    </SymCryptFrame>
  );
}
