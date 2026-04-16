import { useCallback, useState } from "react";
import type { MenuPosition } from "../shared/Menu";
import { StartMenu } from "../shared/StartMenu";
import "./Footer.css";
import { useWorkspace, WORKSPACE_IDS } from "./workspace/WorkspaceProvider";

export function Footer() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { activeWorkspace, setActiveWorkspace } = useWorkspace();

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <footer className="footer">
        <button type="button" onClick={handleClick}>
          Footer
        </button>
        <div className="workspace-switcher">
          {WORKSPACE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`workspace-button${activeWorkspace === id ? " workspace-button--active" : ""}`}
              onClick={() => setActiveWorkspace(id)}
            >
              {id}
            </button>
          ))}
        </div>
      </footer>
      {menu && <StartMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
