import { useCallback } from "react";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { useLocalKeyringLock } from "../../providers/local-keyring/LocalKeyringLockProvider";
import { PaneContextMenuItems } from "../pane/shell/PaneContextMenuItems";
import { Menu, type MenuPosition } from "./Menu";

export function PaneMenu({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  const { generateKey, signingKeyPair } = useIdentity();
  const localKeyringLock = useLocalKeyringLock();
  const hasSigningKeyPair = signingKeyPair !== null;
  const paneLocked = localKeyringLock.isLocked && !hasSigningKeyPair;
  const generateKeyPair = useCallback(() => {
    generateKey();
    onClose();
  }, [generateKey, onClose]);

  return (
    <Menu position={position} onClose={onClose}>
      <PaneContextMenuItems
        hasSigningKeyPair={hasSigningKeyPair}
        paneLocked={paneLocked}
        position={position}
        onClose={onClose}
        onGenerateKeyPair={generateKeyPair}
      />
    </Menu>
  );
}
