import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { useIdentity } from "../../../providers/identity/IdentityProvider";
import { WorkspaceSwitcher } from "../../layout/workspace/WorkspaceSwitcher";
import { DestroyKeyPackageConfirmationDialog } from "../../shared/DestroyKeyPackageConfirmationDialog";
import { LogoutConfirmationDialog } from "../../shared/LogoutConfirmationDialog";
import type { MenuPosition } from "../../shared/Menu";
import { PaneMenu } from "../../shared/PaneMenu";
import { useDestroyKeyPackageConfirmation } from "../../shared/useDestroyKeyPackageConfirmation";
import { useConfirmedLogoutDialog } from "../../shared/useLogoutConfirmation";
import {
  useWindowActions,
  useWindowStateData,
} from "../../window/WindowStateProvider";
import "./PaneFooter.css";

// `tray` is the footer's system tray — persistent launchers that stay reachable
// regardless of which windows are open (currently the System Monitor; more
// affordances will dock here over time). It sits in the right-aligned cluster
// alongside the workspace switcher.
export function PaneFooter({ tray }: { tray?: ReactNode }) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const logoutDialog = useConfirmedLogoutDialog();
  const { destroyKey } = useIdentity();
  const destroyKeyPackageDialog = useDestroyKeyPackageConfirmation(destroyKey);
  const { windows } = useWindowStateData();
  const { restore } = useWindowActions();
  const minimizedWindows = useMemo(
    () => windows.filter((w) => w.minimized),
    [windows],
  );

  const handleClick = useCallback((e: React.MouseEvent) => {
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <div className="pane-footer">
        <button
          type="button"
          className="tearleads-action-button pane-footer-menu-button"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={handleClick}
        >
          Menu
        </button>
        {minimizedWindows.map((w) => (
          <button
            key={w.id}
            type="button"
            className="pane-footer-window"
            onClick={() => restore(w.id)}
          >
            {w.title}
          </button>
        ))}
        <div className="pane-footer-end">
          <WorkspaceSwitcher />
          {tray && <div className="pane-footer-tray">{tray}</div>}
        </div>
      </div>
      {menu && (
        <PaneMenu
          position={menu}
          onClose={closeMenu}
          onRequestDestroyKeyPackage={
            destroyKeyPackageDialog.requestDestroyKeyPackage
          }
          onRequestLogout={logoutDialog.requestLogout}
        />
      )}
      {destroyKeyPackageDialog.isOpen && (
        <DestroyKeyPackageConfirmationDialog
          isOpen={destroyKeyPackageDialog.isOpen}
          onCancel={destroyKeyPackageDialog.closeDestroyKeyPackageDialog}
          onConfirm={destroyKeyPackageDialog.confirmDestroyKeyPackage}
        />
      )}
      {logoutDialog.isOpen && (
        <LogoutConfirmationDialog
          busy={logoutDialog.busy}
          isOpen={logoutDialog.isOpen}
          onCancel={logoutDialog.closeLogoutDialog}
          onConfirm={logoutDialog.confirmLogout}
        />
      )}
    </>
  );
}
