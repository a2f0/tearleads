import { useCallback, useState } from "react";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import "./Pane.css";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function Pane({ className }: { className: string }) {
  const { id, status } = useDatabase();
  const { keyPair } = useCryptoSession();
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
        <br />
        publicKey: {keyPair ? `${toHex(keyPair.publicKey.slice(0, 16))}...` : "none"}
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
