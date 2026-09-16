import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

interface NavItem {
  readonly href: string;
  readonly label: string;
  /** "page" on the item's own page; "true" on pages inside its section. */
  readonly current: (pathname: string) => "page" | "true" | undefined;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/features",
    label: "Features",
    current: (pathname) => (pathname === "/features" ? "page" : undefined),
  },
  {
    href: "/security",
    label: "Security",
    current: (pathname) => (pathname === "/security" ? "page" : undefined),
  },
  {
    href: "/pricing",
    label: "Pricing",
    current: (pathname) => {
      if (pathname === "/pricing") return "page";
      return pathname.startsWith("/manage-subscription") ? "true" : undefined;
    },
  },
  {
    href: "/#download",
    label: "Download",
    current: (pathname) =>
      pathname.startsWith("/downloads") ? "true" : undefined,
  },
];

interface SiteNavProps {
  /** The page path without a trailing slash (Layout.astro normalizes it). */
  readonly pathname?: string | undefined;
}

/**
 * While the menu is open, Escape closes it (returning focus to the toggle when
 * focus was inside the nav), and a primary press or keyboard focus moving
 * outside the nav closes it, so the panel never covers the focused control.
 */
function useDismissableMenu(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement | null>,
  toggleRef: RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      close();
      // Closing hides the list, so a focused link would drop focus to <body>.
      // Return focus to the toggle, but only if focus was inside the nav, so
      // focus elsewhere on the page is never moved.
      if (containerRef.current?.contains(document.activeElement)) {
        toggleRef.current?.focus();
      }
    }

    function onPointerDown(event: PointerEvent) {
      // Only a primary (left or touch) press dismisses; a right or middle
      // click opening a context menu leaves the menu open.
      if (event.button !== 0) {
        return;
      }
      const container = containerRef.current;
      const target = event.target;
      if (container && target instanceof Node && !container.contains(target)) {
        close();
      }
    }

    function onFocusIn(event: FocusEvent) {
      // Tabbing past the last link would otherwise leave the open panel over
      // the next focused control. The toggle is inside the nav, so focusing
      // it keeps the menu open.
      const container = containerRef.current;
      const target = event.target;
      if (container && target instanceof Node && !container.contains(target)) {
        close();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, close, containerRef, toggleRef]);
}

/**
 * The single primary navigation landmark. Wide viewports show the list inline;
 * at 700px and below (see the .site-nav rules in styles/frame.css) a toggle
 * shows the same list as a panel under the header.
 *
 * The layout hydrates this as its own island (slot="nav" with client:media), so
 * the toggle, Escape-to-close, and closing on an outside press or on focus
 * leaving the nav work on phones while the rest of the page stays static. The
 * toggle is part of the static HTML, so the header keeps its size while the
 * island hydrates; with scripting disabled, CSS hides it and shows the inline
 * list instead.
 */
export function SiteNav({ pathname = "" }: SiteNavProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const containerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  useDismissableMenu(open, closeMenu, containerRef, toggleRef);

  return (
    <nav
      aria-label="Primary"
      className="site-nav"
      data-open={open ? "true" : undefined}
      ref={containerRef}
    >
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        className="site-nav-toggle"
        onClick={() => setOpen((value) => !value)}
        ref={toggleRef}
        type="button"
      >
        <span aria-hidden="true" className="site-nav-toggle-icon" />
      </button>
      {/* No role="list" needed: WebKit keeps list semantics inside <nav>. */}
      <ul className="site-nav-list" id={listId}>
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <a
              aria-current={item.current(pathname)}
              className="site-nav-link"
              href={item.href}
              onClick={closeMenu}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
