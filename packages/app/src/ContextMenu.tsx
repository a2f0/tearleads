import { useEffect, useRef } from "react";
import "./ContextMenu.css";

export interface MenuPosition {
  x: number;
  y: number;
}

export function ContextMenu({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        top: position.y,
        left: position.x,
        transform: "translateY(-100%)",
      }}
    >
      <button type="button" onClick={onClose}>
        Action 1
      </button>
      <button type="button" onClick={onClose}>
        Action 2
      </button>
      <button type="button" onClick={onClose}>
        Action 3
      </button>
    </div>
  );
}
