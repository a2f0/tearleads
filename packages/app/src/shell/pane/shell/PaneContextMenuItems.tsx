import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { LockIcon } from "@phosphor-icons/react/dist/csr/Lock";
import { LockOpenIcon } from "@phosphor-icons/react/dist/csr/LockOpen";
import { MenuItem, type MenuPosition } from "@tearleads/windowing";
import { MINI_APP_MENU_ITEMS } from "../../../mini-apps/catalog";
import { useVisibleMiniAppItems } from "../../../mini-apps/useVisibleMiniAppItems";
import { useAppNavigationState } from "../../../navigation/AppNavigationProvider";

import { usePaneLockMenuAction } from "./usePaneLockMenuAction";
import { usePaneWindowMenuActions } from "./usePaneWindowMenuActions";

interface PaneContextMenuItemsProps {
  identityTransitionInFlight: boolean;
  hasSigningKeyPair: boolean;
  paneLocked: boolean;
  position: MenuPosition;
  onClose: () => void;
  onGenerateKeyPair: () => void;
}

export function PaneContextMenuItems({
  identityTransitionInFlight,
  hasSigningKeyPair,
  paneLocked,
  position,
  onClose,
  onGenerateKeyPair,
}: PaneContextMenuItemsProps) {
  const { openMiniApp, openUnlockWindow } = usePaneWindowMenuActions({
    onClose,
    position,
  });
  const { canLockPane, lockPane } = usePaneLockMenuAction(onClose);
  const visibleMenuItems = useVisibleMiniAppItems(MINI_APP_MENU_ITEMS);
  const { definition } = useAppNavigationState();
  const displayProperties = definition.apps["display-properties"];

  const needsIdentity = !hasSigningKeyPair && !paneLocked;

  return (
    <>
      {needsIdentity && (
        <MenuItem
          disabled={identityTransitionInFlight}
          icon={KeyIcon}
          label="Generate Key Pair"
          onClick={onGenerateKeyPair}
        />
      )}
      {paneLocked && (
        <MenuItem
          icon={LockOpenIcon}
          label="Unlock Database"
          onClick={openUnlockWindow}
        />
      )}
      {!needsIdentity && canLockPane && (
        <MenuItem icon={LockIcon} label="Lock" onClick={lockPane} />
      )}
      {visibleMenuItems
        .filter(({ appId }) => !needsIdentity || appId === "system-monitor")
        .map(({ appId }) => {
          const app = definition.apps[appId];
          return app ? (
            <MenuItem
              key={appId}
              icon={app.icon}
              label={app.iconLabel ?? app.title}
              onClick={() => openMiniApp(appId)}
            />
          ) : null;
        })}
      {displayProperties && (
        <MenuItem
          icon={displayProperties.icon}
          label={displayProperties.iconLabel ?? displayProperties.title}
          onClick={() => openMiniApp("display-properties")}
        />
      )}
    </>
  );
}
