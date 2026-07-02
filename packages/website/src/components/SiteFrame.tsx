import { TearleadsFrame, TearleadsLogo } from "@tearleads/ui";
import type { PropsWithChildren } from "react";

interface SiteFrameProps {
  readonly appUrl: string;
  readonly pathname?: string | undefined;
}

const NAV_ITEMS: readonly { readonly href: string; readonly label: string }[] =
  [
    { href: "/how-it-works", label: "How it works" },
    { href: "/security", label: "Security" },
    { href: "/pricing", label: "Pricing" },
    { href: "/features", label: "Features" },
  ];

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
          <nav aria-label="Primary" className="site-nav">
            {NAV_ITEMS.map((item) => (
              <a
                aria-current={pathname === item.href ? "page" : undefined}
                className="site-nav-link"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </a>
            ))}
          </nav>
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
