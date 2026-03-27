import { useCallback, useState } from "react";
import type { MenuPosition } from "./components/shared/Menu";
import { StartMenu } from "./components/shared/StartMenu";
import "./Workspace.css";
import { useWorkspace } from "./WorkspaceProvider";

export function Footer() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const { activeWorkspace, setActiveWorkspace } = useWorkspace();

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <footer>
        <button type="button" onClick={handleClick}>
          Footer
        </button>
        <div className="workspace-switcher">
          {[1, 2].map((id) => (
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
