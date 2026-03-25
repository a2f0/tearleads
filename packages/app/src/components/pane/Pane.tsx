import { toFingerprint } from "@tearleads/crypto";
import { useCallback, useEffect, useState } from "react";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import type { MenuPosition } from "../shared/Menu";
import { PaneMenu } from "../shared/PaneMenu";
import "./Pane.css";

export function Pane({ className }: { className: string }) {
  const { id, status } = useDatabase();
  const { keyPair, userId, authToken } = useCryptoSession();
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
        <br />
        userId: {userId ?? "none"}
        <br />
        session: {authToken ? authToken.slice(0, 32) : "none"}
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
