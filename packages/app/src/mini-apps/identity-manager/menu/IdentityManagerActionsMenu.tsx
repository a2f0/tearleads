import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsThreeVertical";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import {
  Menu,
  MenuItem,
  type MenuPosition,
  useWindowTitleBarAction,
} from "@tearleads/windowing";
import { type MouseEvent, useMemo, useRef, useState } from "react";

const ACTIONS_ICON = <DotsThreeVerticalIcon aria-hidden size={18} />;

/** Registers the signed-in identity's menu beside Refresh in either host. */
export function IdentityManagerActionsMenu({
  disabled,
  onLogout,
}: {
  disabled: boolean;
  onLogout: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const expanded = menuPosition !== null;
  const buttonProps = useMemo(
    () => ({
      // Menu renders ordinary buttons, so announce expansion without claiming
      // the ARIA menu/menuitem pattern via aria-haspopup.
      "aria-expanded": expanded,
      // Avoid outside-click dismissal before the trigger's click toggles the
      // menu, which would otherwise close and immediately reopen it.
      onMouseDown: (event: MouseEvent<HTMLButtonElement>) =>
        event.stopPropagation(),
      ref: buttonRef,
    }),
    [expanded],
  );

  useWindowTitleBarAction({
    buttonProps,
    icon: ACTIONS_ICON,
    id: "identity-manager-actions",
    label: "Identity actions",
    onClick: () => {
      const button = buttonRef.current;
      if (!button) return;
      // Anchor keyboard activation to the button too, rather than to 0,0.
      const rect = button.getBoundingClientRect();
      setMenuPosition((position) =>
        position ? null : { x: rect.left, y: rect.bottom },
      );
    },
  });

  return menuPosition ? (
    <Menu
      direction="down"
      onClose={() => setMenuPosition(null)}
      position={menuPosition}
    >
      <MenuItem
        disabled={disabled}
        icon={SignOutIcon}
        label="Log Out"
        onClick={() => {
          setMenuPosition(null);
          onLogout();
        }}
      />
    </Menu>
  ) : null;
}
