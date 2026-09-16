import { TearleadsFrame, TearleadsLogo } from "@tearleads/ui";
import type { PropsWithChildren, ReactNode } from "react";
import { legalDetails } from "../legal";
import { FOOTER_NAV_ID } from "./SiteNav";

interface SiteFrameProps {
  readonly appUrl: string;
  // The primary nav, supplied by the layout as its own hydrated island (an
  // Astro slot="nav"), so only the nav ships client JS and the frame (header,
  // footer, and slotted page content) stays fully static.
  readonly nav?: ReactNode;
}

interface FooterLink {
  readonly href: string;
  readonly label: string;
  /** Visually hidden destination for external links, e.g. "GitHub". */
  readonly external?: string;
}

interface FooterGroup {
  readonly heading: string;
  readonly links: readonly FooterLink[];
}

function footerGroups(appUrl: string): readonly FooterGroup[] {
  return [
    {
      heading: "Product",
      links: [
        { href: "/features", label: "Features" },
        { href: "/security", label: "Security" },
        { href: "/pricing", label: "Pricing" },
        { href: "/screenshots", label: "Screenshots" },
        {
          href: "https://github.com/a2f0/tearleads/tree/main/docs",
          label: "Technical documents",
          external: "GitHub",
        },
      ],
    },
    {
      heading: "Get Tearleads",
      links: [
        { href: appUrl, label: "Open web app" },
        { href: "/#download", label: "Downloads" },
        { href: "/downloads/linux", label: "Install on Linux" },
      ],
    },
    {
      heading: "Account and legal",
      links: [
        { href: "/manage-subscription", label: "Manage subscription" },
        { href: "/privacy-policy", label: "Privacy Policy" },
        { href: "/terms-of-service", label: "Terms of Service" },
        { href: `mailto:${legalDetails.email}`, label: legalDetails.email },
      ],
    },
  ];
}

function SiteFooter({ appUrl }: { readonly appUrl: string }) {
  // Build time, like the rest of the static page.
  const year = new Date().getUTCFullYear();
  const location = legalDetails.location.replace(/, United States$/, "");
  return (
    <div className="site-footer">
      <nav
        aria-label="Footer"
        className="site-footer-groups"
        id={FOOTER_NAV_ID}
      >
        {footerGroups(appUrl).map((group) => (
          <div key={group.heading}>
            <h2 className="site-footer-heading">{group.heading}</h2>
            <ul className="site-footer-list">
              {group.links.map((link) => (
                <li key={link.href}>
                  <a className="site-footer-link" href={link.href}>
                    {link.label}
                    {link.external && (
                      <>
                        <span aria-hidden="true"> ↗</span>
                        <span className="visually-hidden">
                          {` (${link.external})`}
                        </span>
                      </>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="site-footer-meta">
        <p>
          © {year} <span className="site-nowrap">{legalDetails.operator}</span>
          <span aria-hidden="true"> · </span>
          <span className="visually-hidden">, </span>
          <span className="site-nowrap">{location}</span>
        </p>
        <p>
          {/* Quoted exactly from Privacy Policy section 6. */}
          <a href="/privacy-policy#device-storage">
            The marketing website does not use advertising trackers or analytics
            cookies.
          </a>
        </p>
      </div>
    </div>
  );
}

export function SiteFrame({
  appUrl,
  children,
  nav,
}: PropsWithChildren<SiteFrameProps>) {
  return (
    <TearleadsFrame
      brandHref="/"
      brandLogo={<TearleadsLogo />}
      className="site-frame"
      footerStart={<SiteFooter appUrl={appUrl} />}
      headerActions={
        <>
          {nav}
          <a className="site-app-button" href={appUrl}>
            Open app
          </a>
        </>
      }
    >
      {children}
    </TearleadsFrame>
  );
}
