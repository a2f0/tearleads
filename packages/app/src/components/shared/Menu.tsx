import {
  type CSSProperties,
  type PropsWithChildren,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./Menu.css";

const MENU_VIEWPORT_MARGIN_PX = 8;
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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

function getViewportSize(): { height: number; width: number } {
  if (typeof window === "undefined") {
    return { height: 0, width: 0 };
  }

  return {
    height: window.innerHeight || document.documentElement.clientHeight,
    width: window.innerWidth || document.documentElement.clientWidth,
  };
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
  children,
}: PropsWithChildren<{
  position: MenuPosition;
  onClose: () => void;
  direction?: "up" | "down";
}>) {
  const menuRef = useRef<HTMLDivElement>(null);
  const canMeasureMenu =
    typeof window !== "undefined" && typeof document !== "undefined";
  const { x, y } = position;
  const [placement, setPlacement] = useState(() =>
    createInitialMenuPlacement(position, direction),
  );

  useBrowserLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !canMeasureMenu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    const viewportSize = getViewportSize();
    setPlacement(
      placeMenuInViewport({
        direction,
        height: rect.height,
        position,
        viewportHeight: viewportSize.height,
        viewportWidth: viewportSize.width,
        width: rect.width,
      }),
    );
  }, [x, y, direction, canMeasureMenu]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) {
        onClose();
        return;
      }

      if (menuRef.current && !menuRef.current.contains(target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const placementMatchesAnchor =
    placement.measured &&
    placement.anchorX === position.x &&
    placement.anchorY === position.y &&
    placement.anchorDirection === direction;
  const fallbackMenuStyle: CSSProperties = {
    left: position.x,
    top: position.y,
    ...(direction === "up" && { transform: "translateY(-100%)" }),
  };
  const menuStyle: CSSProperties = !canMeasureMenu
    ? fallbackMenuStyle
    : placementMatchesAnchor
      ? {
          left: placement.left,
          maxHeight: placement.maxHeight,
          maxWidth: placement.maxWidth,
          top: placement.top,
        }
      : {
          left: position.x,
          top: position.y,
          visibility: "hidden",
        };

  const menu = (
    <div ref={menuRef} className="menu" style={menuStyle}>
      {children}
    </div>
  );

  if (typeof document === "undefined") {
    return menu;
  }

  return createPortal(menu, document.body);
}
