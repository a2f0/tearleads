import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { MiniAppRowActionsButton } from "../../components/mini-app/MiniAppTable";
import { classNames } from "../../components/shared/classNames";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import { MenuItem } from "../../components/shared/MenuItem";

export function TrackerReadActions(params: {
  actionsAriaLabel: string;
  className?: string | undefined;
  detailLabel: string;
  detailsOpen: boolean;
  directAriaLabel: string;
  onEnterEdit?: (() => void) | undefined;
  onOpenDetails: () => void;
}) {
  const {
    actionsAriaLabel,
    className,
    detailLabel,
    detailsOpen,
    directAriaLabel,
    onEnterEdit,
    onOpenDetails,
  } = params;
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!onEnterEdit) {
      setMenuPosition(null);
    }
  }, [onEnterEdit]);

  if (!onEnterEdit) {
    // A read-only viewer has one action, so open the detail directly instead of
    // making keyboard and pointer users traverse a one-item menu.
    return (
      <MiniAppRowActionsButton
        aria-expanded={detailsOpen}
        aria-haspopup="dialog"
        aria-label={directAriaLabel}
        className={classNames("tracker-read-actions", className)}
        onClick={onOpenDetails}
      />
    );
  }

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (menuPosition !== null) {
      setMenuPosition(null);
      return;
    }
    // Anchor to the button box so keyboard activation, which reports 0,0
    // pointer coordinates, still opens the menu below its trigger.
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left, y: rect.bottom });
  };
  const closeMenu = () => setMenuPosition(null);

  return (
    <>
      <MiniAppRowActionsButton
        ref={actionsButtonRef}
        aria-expanded={menuPosition !== null}
        aria-label={actionsAriaLabel}
        className={classNames("tracker-read-actions", className)}
        onClick={toggleMenu}
        // Keep mousedown away from the Menu outside-click handler so clicking
        // the trigger again can toggle the open menu shut.
        onMouseDown={(event) => event.stopPropagation()}
      />
      {menuPosition ? (
        <Menu direction="down" onClose={closeMenu} position={menuPosition}>
          <MenuItem
            icon={PencilSimpleIcon}
            label="Edit"
            onClick={() => {
              closeMenu();
              onEnterEdit();
            }}
          />
          <MenuItem
            icon={InfoIcon}
            label={detailLabel}
            onClick={() => {
              // Restore focus to the trigger before the overlay mounts so its
              // own close-time focus restore has a stable destination.
              actionsButtonRef.current?.focus();
              closeMenu();
              onOpenDetails();
            }}
          />
        </Menu>
      ) : null}
    </>
  );
}
