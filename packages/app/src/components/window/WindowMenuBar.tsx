import { useCallback, useEffect, useRef, useState } from "react";
import "./WindowMenuBar.css";

interface MenuItemDef {
  label: string;
  onClick: () => void;
}

interface MenuDef {
  label: string;
  items: MenuItemDef[];
}

export function WindowMenuBar({ menus }: { menus: MenuDef[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenIndex(null), []);

  useEffect(() => {
    if (openIndex === null) return;
    function handleMouseDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openIndex, close]);

  return (
    <div ref={barRef} className="window-menubar" role="menubar">
      {menus.map((menu, i) => (
        <div key={menu.label} className="window-menubar-item">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={openIndex === i}
            className={
              openIndex === i
                ? "window-menubar-trigger window-menubar-trigger--active"
                : "window-menubar-trigger"
            }
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            onMouseEnter={() => {
              if (openIndex !== null) setOpenIndex(i);
            }}
          >
            {menu.label}
          </button>
          {openIndex === i && (
            <div className="window-menubar-dropdown" role="menu">
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    item.onClick();
                    close();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
