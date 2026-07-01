import type { MenuPosition } from "../../shared/Menu";
import { Menu } from "../../shared/Menu";
import { PaneContextMenuItems } from "./PaneContextMenuItems";

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
  return (
    <Menu position={position} onClose={onClose}>
      <PaneContextMenuItems
        hasSigningKeyPair={hasSigningKeyPair}
        paneLocked={paneLocked}
        position={position}
        onClose={onClose}
        onGenerateKeyPair={onGenerateKeyPair}
      />
    </Menu>
  );
}
