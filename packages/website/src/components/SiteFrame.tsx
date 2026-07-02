import { TearleadsFrame, TearleadsLogo } from "@tearleads/ui";
import type { PropsWithChildren } from "react";
import { SiteNav } from "./SiteNav";

interface SiteFrameProps {
  readonly appUrl: string;
  readonly pathname?: string | undefined;
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
  pathname,
}: PropsWithChildren<SiteFrameProps>) {
  return (
    <TearleadsFrame
      brandHref="/"
      brandLogo={<TearleadsLogo />}
      footerStart={<FooterLinks />}
      headerActions={
        <>
          <SiteNav pathname={pathname} />
          <a className="tearleads-action-button site-app-button" href={appUrl}>
            App
          </a>
        </>
      }
    >
      {children}
    </TearleadsFrame>
  );
}
