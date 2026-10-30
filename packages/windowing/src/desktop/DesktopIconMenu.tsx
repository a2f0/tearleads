import type { WindowingIcon } from "../icons/windowingIcon";
import { Menu, type MenuPosition } from "../menu/Menu";
import { MenuItem } from "../menu/MenuItem";

/** An item a host adds to an icon's context menu, below Open. */
export interface DesktopIconMenuItem {
  disabled?: boolean | undefined;
  icon?: WindowingIcon | undefined;
  id: string;
  label: string;
  onSelect: () => void;
}

/** An icon's context menu: Open, then the host's items. Each closes it. */
export function DesktopIconMenu({
  icon,
  items,
  onClose,
  onOpen,
  position,
}: {
  icon: WindowingIcon | undefined;
  items: ReadonlyArray<DesktopIconMenuItem>;
  onClose: () => void;
  onOpen: () => void;
  position: MenuPosition;
}) {
  return (
    <Menu direction="down" onClose={onClose} position={position}>
      <MenuItem
        icon={icon}
        label="Open"
        onClick={() => {
          onClose();
          onOpen();
        }}
      />
      {items.map((item) => (
        <MenuItem
          disabled={item.disabled}
          icon={item.icon}
          key={item.id}
          label={item.label}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        />
      ))}
    </Menu>
  );
}
