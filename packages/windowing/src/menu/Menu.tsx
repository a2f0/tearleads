import {
  type CSSProperties,
  type PropsWithChildren,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./Menu.css";
import { useMenuKeyboard } from "./useMenuKeyboard";

const MENU_VIEWPORT_MARGIN_PX = 8;
const MEASUREMENT_MENU_STYLE: CSSProperties = {
  left: MENU_VIEWPORT_MARGIN_PX,
  pointerEvents: "none",
  top: MENU_VIEWPORT_MARGIN_PX,
  visibility: "hidden",
};

// Fractional layout or zoom can report a spurious pixel of overflow; treat
// that as fitting, since a false positive hands touch panning to the page.
const SCROLL_OVERFLOW_TOLERANCE_PX = 1;

function overflows(element: HTMLElement): boolean {
  return (
    element.scrollHeight > element.clientHeight + SCROLL_OVERFLOW_TOLERANCE_PX
  );
}

/**
 * Whether touch should be allowed to pan inside the menu: its own box scrolls,
 * or a descendant scroll container (a select menu's option list) does. The
 * menu box is a scroll container by its stylesheet; descendants qualify by
 * their computed overflow so a plain overflowing block does not count.
 */
function hasTouchScrollableContent(menu: HTMLElement): boolean {
  if (overflows(menu)) {
    return true;
  }

  for (const element of Array.from(menu.querySelectorAll<HTMLElement>("*"))) {
    if (!overflows(element)) {
      continue;
    }
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return true;
    }
  }

  return false;
}

/**
 * Dismiss the menu on a pointer press or a scroll outside it. The closer is
 * read through an effect event: consumers commonly pass an inline one, and
 * the document listeners should subscribe once, not on every render.
 */
function useMenuOutsideDismissal(
  menuRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  const close = useEffectEvent(onClose);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) {
        close();
        return;
      }

      if (menuRef.current && !menuRef.current.contains(target)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuRef]);

  // The menu is anchored once, from its trigger's position, so a scroll
  // anywhere else would leave it floating where the trigger used to be. Close
  // it instead. Scrolls inside the menu — its own overflow, or a list it
  // hosts — are the menu working as intended. Capture phase, because scroll
  // events do not bubble. The check covers this menu's own subtree only: a
  // nested Menu is portaled to the body too, so scrolling one would close its
  // parent. Nothing nests menus today; revisit here if that changes.
  useEffect(() => {
    function handleScroll(e: Event) {
      const target = e.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      close();
    }
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [menuRef]);
}

export interface MenuPosition {
  x: number;
  y: number;
}

interface MenuPlacement {
  anchorDirection: "up" | "down";
  anchorX: number;
  anchorY: number;
  left: number;
  maxHeight: number | undefined;
  maxWidth: number | undefined;
  measured: boolean;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createInitialMenuPlacement(
  position: MenuPosition,
  direction: "up" | "down",
): MenuPlacement {
  return {
    anchorDirection: direction,
    anchorX: position.x,
    anchorY: position.y,
    left: position.x,
    maxHeight: undefined,
    maxWidth: undefined,
    measured: false,
    top: position.y,
  };
}

function placeMenuInViewport(input: {
  direction: "up" | "down";
  height: number;
  position: MenuPosition;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
}): MenuPlacement {
  const availableWidth = Math.max(
    0,
    input.viewportWidth - MENU_VIEWPORT_MARGIN_PX * 2,
  );
  const availableHeight = Math.max(
    0,
    input.viewportHeight - MENU_VIEWPORT_MARGIN_PX * 2,
  );
  const boundedWidth = Math.min(input.width, availableWidth);
  const boundedHeight = Math.min(input.height, availableHeight);
  const maxLeft = Math.max(
    MENU_VIEWPORT_MARGIN_PX,
    input.viewportWidth - MENU_VIEWPORT_MARGIN_PX - boundedWidth,
  );
  const maxTop = Math.max(
    MENU_VIEWPORT_MARGIN_PX,
    input.viewportHeight - MENU_VIEWPORT_MARGIN_PX - boundedHeight,
  );
  const preferredTop =
    input.direction === "up"
      ? input.position.y - boundedHeight
      : input.position.y;

  return {
    anchorDirection: input.direction,
    anchorX: input.position.x,
    anchorY: input.position.y,
    left: clamp(input.position.x, MENU_VIEWPORT_MARGIN_PX, maxLeft),
    maxHeight: availableHeight > 0 ? availableHeight : undefined,
    maxWidth: availableWidth > 0 ? availableWidth : undefined,
    measured: true,
    top: clamp(preferredTop, MENU_VIEWPORT_MARGIN_PX, maxTop),
  };
}

export function Menu({
  position,
  onClose,
  direction = "up",
  keyboardNavigation = true,
  children,
}: PropsWithChildren<{
  position: MenuPosition;
  onClose: () => void;
  direction?: "up" | "down";
  keyboardNavigation?: boolean;
}>) {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuOutsideDismissal(menuRef, onClose);
  const { x, y } = position;
  const [placement, setPlacement] = useState(() =>
    createInitialMenuPlacement(position, direction),
  );
  // Whether anything in the menu scrolls, so the stylesheet can let touch pan
  // it while consuming swipes on a menu that fits (see Menu.css).
  const [scrollable, setScrollable] = useState(false);

  // Re-measure after every commit as well as on resize below: children can be
  // swapped or filtered while the menu is open without its box changing size,
  // which moves scrollHeight but not the ResizeObserver. setState bails out
  // when the answer is unchanged.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu) {
      setScrollable(hasTouchScrollableContent(menu));
    }
  });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    const updatePlacement = () => {
      const rect = menu.getBoundingClientRect();
      setPlacement(
        placeMenuInViewport({
          direction,
          height: rect.height,
          position,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          width: rect.width,
        }),
      );
      setScrollable(hasTouchScrollableContent(menu));
    };
    updatePlacement();
    const observer = new ResizeObserver(updatePlacement);
    observer.observe(menu);
    window.addEventListener("resize", updatePlacement);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePlacement);
    };
  }, [x, y, direction]);

  const placementMatchesAnchor =
    placement.measured &&
    placement.anchorX === position.x &&
    placement.anchorY === position.y &&
    placement.anchorDirection === direction;
  useMenuKeyboard(
    menuRef,
    placementMatchesAnchor && keyboardNavigation,
    onClose,
  );
  const menuStyle: CSSProperties = placementMatchesAnchor
    ? {
        left: placement.left,
        maxHeight: placement.maxHeight,
        maxWidth: placement.maxWidth,
        top: placement.top,
      }
    : MEASUREMENT_MENU_STYLE;

  return createPortal(
    <div
      ref={menuRef}
      className="menu"
      data-scrollable={scrollable || undefined}
      style={menuStyle}
      tabIndex={-1}
    >
      {children}
    </div>,
    document.body,
  );
}
