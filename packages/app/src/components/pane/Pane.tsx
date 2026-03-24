import { useCallback, useEffect, useState } from "react";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import "./Pane.css";

async function toFingerprint(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function Pane({ className }: { className: string }) {
  const { id, status } = useDatabase();
  const { keyPair } = useCryptoSession();
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    if (keyPair) {
      toFingerprint(keyPair.publicKey).then(setFingerprint);
    } else {
      setFingerprint(null);
    }
  }, [keyPair]);

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
        publicKey: {fingerprint ?? "none"}
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
