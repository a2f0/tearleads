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

interface NavLinksProps {
  readonly pathname?: string | undefined;
  readonly onNavigate: () => void;
}

/** The link list, rendered once inline and once in the dropdown panel. */
function NavLinks({ pathname, onNavigate }: NavLinksProps) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <a
          aria-current={pathname === item.href ? "page" : undefined}
          className="site-nav-link"
          href={item.href}
          key={item.href}
          onClick={onNavigate}
        >
          {item.label}
        </a>
      ))}
    </>
  );
}

/**
 * Primary site navigation. On wide viewports the links render inline; on narrow
 * viewports (see the .site-nav* rules in global.css) the inline list is hidden
 * and a hamburger toggles an expanding panel of the same links.
 *
 * The layout hydrates this as its own island (slot="nav" with client:media) so
 * the toggle state, Escape-to-close, and outside-click-to-close work on mobile
 * while the rest of the page stays static. Without JS the inline list is still
 * in the HTML and the toggle is never rendered, so the links remain usable.
 */
export function SiteNav({ pathname }: SiteNavProps) {
  const [open, setOpen] = useState(false);
  // False until the island hydrates. The hamburger only works with JS, so it is
  // rendered only once mounted; without JS the inline links stay visible (see
  // the [data-js] rules in global.css) and no dead toggle is shown.
  const [mounted, setMounted] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

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
        // Closing hides the panel, so the focused link would drop focus to
        // <body>. Return focus to the toggle for keyboard/screen-reader users.
        toggleRef.current?.focus();
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

  const closeMenu = () => setOpen(false);

  return (
    <div
      className="site-nav-root"
      data-js={mounted || undefined}
      ref={containerRef}
    >
      <nav aria-label="Primary" className="site-nav">
        <NavLinks onNavigate={closeMenu} pathname={pathname} />
      </nav>
      {mounted && (
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="site-nav-toggle"
          onClick={() => setOpen((value) => !value)}
          ref={toggleRef}
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
        <NavLinks onNavigate={closeMenu} pathname={pathname} />
      </nav>
    </div>
  );
}
