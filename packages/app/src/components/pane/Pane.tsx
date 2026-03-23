import { useCallback, useState } from "react";
import { useDatabase } from "../../db/DatabaseProvider";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import "./Pane.css";

export function Pane({ className }: { className: string }) {
  const { id, status } = useDatabase();
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <section className={className}>
      <div className="pane-content">
        worker: {status}
        <br />
        id: {id}
      </div>
      <div className="pane-footer">
        <button type="button" onClick={handleClick}>
          Menu
        </button>
      </div>
      {menu && <PaneMenu position={menu} onClose={closeMenu} />}
    </section>
  );
}
