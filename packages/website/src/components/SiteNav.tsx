import { useEffect, useId, useRef, useState } from "react";

const NAV_ITEMS: readonly { readonly href: string; readonly label: string }[] =
  [
    { href: "/how-it-works", label: "How it works" },
    { href: "/security", label: "Security" },
    { href: "/pricing", label: "Pricing" },
    { href: "/features", label: "Features" },
  ];

interface SiteNavProps {
  readonly pathname?: string | undefined;
}

/**
 * Primary site navigation. On wide viewports the links render inline; on narrow
 * viewports (see the .site-nav* rules in global.css) the inline list is hidden
 * and a hamburger toggles an expanding panel of the same links.
 *
 * This is hydrated as an island (SiteFrame is rendered with client:load) so the
 * toggle state, Escape-to-close, and outside-click-to-close all work. With no
 * JS the inline list is still present in the HTML, so the links remain usable.
 */
export function SiteNav({ pathname }: SiteNavProps) {
  const [open, setOpen] = useState(false);
  // False until the island hydrates. The hamburger only works with JS, so it is
  // rendered only once mounted; without JS the inline links stay visible (see
  // the [data-js] rules in global.css) and no dead toggle is shown.
  const [mounted, setMounted] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    function onPointerDown(event: PointerEvent) {
      const container = containerRef.current;
      const target = event.target;
      if (container && target instanceof Node && !container.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // Rendered in two places (inline nav + dropdown panel); build fresh element
  // instances each time rather than reusing one array across both trees.
  const renderLinks = () =>
    NAV_ITEMS.map((item) => (
      <a
        aria-current={pathname === item.href ? "page" : undefined}
        className="site-nav-link"
        href={item.href}
        key={item.href}
        onClick={() => setOpen(false)}
      >
        {item.label}
      </a>
    ));

  return (
    <div
      className="site-nav-root"
      data-js={mounted || undefined}
      ref={containerRef}
    >
      <nav aria-label="Primary" className="site-nav">
        {renderLinks()}
      </nav>
      {mounted && (
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="site-nav-toggle"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span aria-hidden="true" className="site-nav-toggle-bars" />
        </button>
      )}
      <nav
        aria-label="Primary"
        className="site-nav-panel"
        data-open={open}
        id={panelId}
        hidden={!open}
      >
        {renderLinks()}
      </nav>
    </div>
  );
}
