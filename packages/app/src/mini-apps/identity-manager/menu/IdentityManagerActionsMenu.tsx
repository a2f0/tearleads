import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { type MouseEvent, useState } from "react";
import { MiniAppRowActionsButton } from "../../../components/mini-app/MiniAppTable";
import { Menu, type MenuPosition } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";

/**
 * Overflow menu for the Identity section. Mirrors the kebab menu on the
 * explorer's item rows (a `DotsThreeVertical` button that opens a small menu),
 * keeping the current-session logout out of the action toolbar so the toolbar's
 * horizontal space stays available for the identity/key-package actions.
 *
 * Renders nothing while signed out — logout is the only entry, so an empty
 * trigger would be dead weight.
 */
export function IdentityManagerActionsMenu({
  disabled,
  isAuthenticated,
  onLogout,
}: {
  disabled: boolean;
  isAuthenticated: boolean;
  onLogout: () => void;
}) {
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  if (!isAuthenticated) {
    return null;
  }

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (menuPosition !== null) {
      setMenuPosition(null);
      return;
    }
    // Anchor to the button's box (not the pointer) so keyboard activation, which
    // reports 0,0 client coordinates, still opens the menu under the trigger.
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left, y: rect.bottom });
  };
  const closeMenu = () => setMenuPosition(null);

  return (
    <>
      <MiniAppRowActionsButton
        aria-expanded={menuPosition !== null}
        aria-label="Identity actions"
        onClick={toggleMenu}
        // Keep the trigger's mousedown from reaching the Menu's document-level
        // outside-click handler. Without this, re-clicking the trigger closes the
        // menu on mousedown and the following click reopens it, so the button
        // could never toggle the menu shut.
        onMouseDown={(event) => event.stopPropagation()}
        title="Identity actions"
      />
      {menuPosition ? (
        <Menu direction="down" onClose={closeMenu} position={menuPosition}>
          <MenuItem
            disabled={disabled}
            icon={SignOutIcon}
            label="Log Out"
            onClick={() => {
              closeMenu();
              onLogout();
            }}
          />
        </Menu>
      ) : null}
    </>
  );
}
