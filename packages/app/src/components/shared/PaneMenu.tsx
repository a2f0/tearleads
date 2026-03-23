import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";

export function PaneMenu({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  return (
    <Menu position={position} onClose={onClose}>
      <MenuItem label="Action 1" onClick={onClose} />
      <MenuItem label="Action 2" onClick={onClose} />
      <MenuItem label="Action 3" onClick={onClose} />
    </Menu>
  );
}
