import { TearleadsFrame } from "@tearleads/ui";
import type { PropsWithChildren } from "react";

interface SiteFrameProps {
  readonly appUrl: string;
}

const NAV_ITEMS: readonly { readonly href: string; readonly label: string }[] =
  [
    { href: "/#how-it-works", label: "How it works" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/#features", label: "Features" },
  ];

export function SiteFrame({
  appUrl,
  children,
}: PropsWithChildren<SiteFrameProps>) {
  return (
    <TearleadsFrame
      brandHref="/"
      footerEnd="Static HTML"
      headerActions={
        <>
          <nav aria-label="Primary" className="site-nav">
            {NAV_ITEMS.map((item) => (
              <a className="site-nav-link" href={item.href} key={item.href}>
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
