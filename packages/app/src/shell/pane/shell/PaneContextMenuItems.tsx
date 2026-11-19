import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { LockIcon } from "@phosphor-icons/react/dist/csr/Lock";
import { LockOpenIcon } from "@phosphor-icons/react/dist/csr/LockOpen";
import {
  LauncherMenuItem,
  MenuItem,
  type MenuPosition,
  useOptionalStartMenuPreferences,
} from "@tearleads/windowing";
import { useAccountBootstrapProgress } from "../../../identity/useAccountBootstrapProgress";
import { MINI_APP_MENU_ITEMS } from "../../../mini-apps/catalog";
import { useVisibleMiniAppItems } from "../../../mini-apps/useVisibleMiniAppItems";
import { useAppNavigationState } from "../../../navigation/AppNavigationProvider";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { AppScreensaverMenuItem } from "../../layout/AppScreensaverHost";

import { usePaneLockMenuAction } from "./usePaneLockMenuAction";
import { usePaneWindowMenuActions } from "./usePaneWindowMenuActions";

interface PaneContextMenuItemsProps {
  surface: "desktop" | "start";
  identityTransitionInFlight: boolean;
  hasSigningKeyPair: boolean;
  paneLocked: boolean;
  position: MenuPosition;
  onClose: () => void;
  onGenerateKeyPair: () => void;
}

export function PaneContextMenuItems({
  surface,
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
  const preferences = useOptionalStartMenuPreferences();
  const visibleMenuItems = useVisibleMiniAppItems(MINI_APP_MENU_ITEMS);
  const { definition } = useAppNavigationState();
  const progress = useAccountBootstrapProgress();
  const provisioning =
    useAppHostConfig().profile.features.autoGenerateIdentity &&
    progress !== null;
  const settings = definition.apps["display-properties"];

  const AppItem = surface === "start" ? LauncherMenuItem : MenuItem;
  const needsIdentity = !hasSigningKeyPair && !paneLocked;

  return (
    <>
      {needsIdentity && !provisioning && (
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
        .filter(
          ({ appId }) =>
            surface !== "start" || (preferences?.isVisible(appId) ?? true),
        )
        .filter(
          ({ appId }) =>
            !needsIdentity ||
            appId === "system-monitor" ||
            (provisioning && appId === "identity-manager"),
        )
        .map(({ appId }) => {
          const app = definition.apps[appId];
          return app ? (
            <AppItem
              key={appId}
              icon={app.icon}
              label={app.iconLabel ?? app.title}
              onClick={() => openMiniApp(appId)}
            />
          ) : null;
        })}
      {settings && (
        <AppItem
          icon={settings.icon}
          label={settings.iconLabel ?? settings.title}
          onClick={() => openMiniApp("display-properties")}
        />
      )}
      {surface === "desktop" && <AppScreensaverMenuItem onClose={onClose} />}
    </>
  );
}
