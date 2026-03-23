import { useCallback, useState } from "react";
import type { MenuPosition } from "./components/shared/Menu";
import { StartMenu } from "./components/shared/StartMenu";

export function Footer() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);

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
      </footer>
      {menu && <StartMenu position={menu} onClose={closeMenu} />}
    </>
  );
}
