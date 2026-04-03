import { type PropsWithChildren, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./Menu.css";

export interface MenuPosition {
  x: number;
  y: number;
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

  const menu = (
    <div
      ref={menuRef}
      className="menu"
      style={{
        top: position.y,
        left: position.x,
        ...(direction === "up" && { transform: "translateY(-100%)" }),
      }}
    >
      {children}
    </div>
  );

  if (typeof document === "undefined") {
    return menu;
  }

  return createPortal(menu, document.body);
}
