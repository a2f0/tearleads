import { useCallback, useEffect, useRef, useState } from "react";
import "./WindowMenuBar.css";

export interface WindowMenuItem {
  disabled?: boolean;
  id: string;
  label: string;
  onClick: () => void;
}

interface WindowMenu {
  label: string;
  items: WindowMenuItem[];
}

export function WindowMenuBar({ menus }: { menus: WindowMenu[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenIndex(null), []);

  useEffect(() => {
    if (openIndex === null) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) {
        close();
        return;
      }

      if (barRef.current && !barRef.current.contains(target)) {
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
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) {
                      return;
                    }
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
