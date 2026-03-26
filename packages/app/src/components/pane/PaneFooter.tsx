import { useCallback, useState } from "react";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import "./PaneFooter.css";

export function PaneFooter() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <div className="pane-footer">
        <button type="button" onClick={handleClick}>
          Menu
        </button>
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
