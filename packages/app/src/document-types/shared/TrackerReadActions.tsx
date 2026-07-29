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
  directAriaLabel: string;
  onEnterEdit?: (() => void) | undefined;
  onOpenDetails: () => void;
}) {
  const {
    actionsAriaLabel,
    className,
    detailLabel,
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
    return (
      <MiniAppRowActionsButton
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
