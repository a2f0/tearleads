import { LockIcon } from "@phosphor-icons/react/dist/csr/Lock";
import { LockOpenIcon } from "@phosphor-icons/react/dist/csr/LockOpen";
import { MINI_APP_MENU_ITEMS } from "../../../mini-apps/registry";
import type { MenuPosition } from "../../shared/Menu";
import { Menu } from "../../shared/Menu";
import { MenuItem } from "../../shared/MenuItem";

import { usePaneLockMenuAction } from "./usePaneLockMenuAction";
import { usePaneWindowMenuActions } from "./usePaneWindowMenuActions";

interface PaneContextMenuProps {
  hasSigningKeyPair: boolean;
  paneLocked: boolean;
  position: MenuPosition;
  onClose: () => void;
  onGenerateKeyPair: () => void;
}

export function PaneContextMenu({
  hasSigningKeyPair,
  paneLocked,
  position,
  onClose,
  onGenerateKeyPair,
}: PaneContextMenuProps) {
  const { openMiniApp, openUnlockWindow } = usePaneWindowMenuActions({
    onClose,
    position,
  });
  const { canLockPane, lockPane } = usePaneLockMenuAction(onClose);

  return (
    <Menu position={position} onClose={onClose}>
      {!hasSigningKeyPair && !paneLocked ? (
        <MenuItem label="Generate Key Pair" onClick={onGenerateKeyPair} />
      ) : (
        <>
          {paneLocked && (
            <MenuItem
              icon={LockOpenIcon}
              label="Unlock Database"
              onClick={openUnlockWindow}
            />
          )}
          {canLockPane && (
            <MenuItem icon={LockIcon} label="Lock" onClick={lockPane} />
          )}
          {MINI_APP_MENU_ITEMS.map(({ appId, icon, label }) => (
            <MenuItem
              key={appId}
              icon={icon}
              label={label}
              onClick={() => openMiniApp(appId)}
            />
          ))}
        </>
      )}
    </Menu>
  );
}
