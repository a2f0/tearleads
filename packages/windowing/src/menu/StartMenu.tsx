import type { ReactNode } from "react";
import type { WindowingIcon } from "../icons/windowingIcon";
import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";
import "./StartMenu.css";
import { useContextMenuPositionState } from "./useContextMenuState";

/** One entry in a {@link StartMenu}. */
export interface StartMenuItem {
  disabled?: boolean | undefined;
  icon?: WindowingIcon | undefined;
  id: string;
  label: string;
  /**
   * Runs when the item is chosen, after the menu closes. `position` is where
   * the menu opened, for placing what the item opens near it.
   */
  onSelect: (position: MenuPosition) => void;
}

export interface StartMenuProps {
  /**
   * Classes for the button. They replace the default `start-menu-button`
   * styling, so a host's own button styles apply alone.
   */
  className?: string | undefined;
  /** What the button shows, such as a logo or an icon. */
  icon: ReactNode;
  /** The menu's entries, in order. Ignored when `renderMenu` is given. */
  items?: readonly StartMenuItem[] | undefined;
  /** The button's accessible name. */
  label?: string | undefined;
  /**
   * Renders the open menu itself, such as a `Menu` whose content needs more
   * than a list of items, in place of `items`. Call `close` to close it.
   */
  renderMenu?:
    | ((menu: { close: () => void; position: MenuPosition }) => ReactNode)
    | undefined;
}

/**
 * A taskbar's start menu: a button, usually at the bar's leading edge, that
 * opens a menu above its top-left corner. Give it `items` for a list of
 * entries, or `renderMenu` to render the menu yourself.
 */
export function StartMenu({
  className,
  icon,
  items = [],
  label = "Menu",
  renderMenu,
}: StartMenuProps) {
  const {
    closeContextMenu: close,
    contextMenu: position,
    openContextMenuAt,
  } = useContextMenuPositionState();

  return (
    <>
      <button
        type="button"
        className={className ?? "start-menu-button"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          openContextMenuAt({ x: bounds.left, y: bounds.top });
        }}
      >
        {icon}
      </button>
      {position &&
        (renderMenu ? (
          renderMenu({ close, position })
        ) : (
          <Menu position={position} onClose={close}>
            {items.map((item) => (
              <MenuItem
                key={item.id}
                disabled={item.disabled}
                icon={item.icon}
                label={item.label}
                onClick={() => {
                  close();
                  item.onSelect(position);
                }}
              />
            ))}
          </Menu>
        ))}
    </>
  );
}
