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
import { useMenuKeyboard } from "./useMenuKeyboard";

const MENU_VIEWPORT_MARGIN_PX = 8;
const MEASUREMENT_MENU_STYLE: CSSProperties = {
  left: MENU_VIEWPORT_MARGIN_PX,
  pointerEvents: "none",
  top: MENU_VIEWPORT_MARGIN_PX,
  visibility: "hidden",
};

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
  const { x, y } = position;
  const [placement, setPlacement] = useState(() =>
    createInitialMenuPlacement(position, direction),
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    function updatePlacement() {
      if (!menu) return;
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
    }
    updatePlacement();
    const observer = new ResizeObserver(updatePlacement);
    observer.observe(menu);
    window.addEventListener("resize", updatePlacement);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePlacement);
    };
  }, [x, y, direction]);

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
    <div ref={menuRef} className="menu" style={menuStyle}>
      {children}
    </div>,
    document.body,
  );
}
