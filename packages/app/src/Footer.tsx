import { useCallback, useState } from "react";
import { ContextMenu, type MenuPosition } from "./ContextMenu";

export function Footer() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <footer>
        <button type="button" onContextMenu={handleContextMenu}>
          Footer
        </button>
      </footer>
      {menu && <ContextMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
