import type { WindowingIcon } from "../icons/windowingIcon";
import { Menu } from "../menu/Menu";
import { MenuItem } from "../menu/MenuItem";
import { useContextMenuState } from "../menu/useContextMenuState";
import { useLongPress } from "../menu/useLongPress";
import { useOptionalSystemTray } from "./SystemTrayProvider";
import "./SystemTray.css";

/** An item a host adds to every tray app's context menu, below Disable. */
export interface SystemTrayMenuItem {
  icon?: WindowingIcon | undefined;
  id: string;
  label: string;
  onSelect: () => void;
}

interface SystemTrayProps {
  /**
   * Items below "Disable <app>" in each tray app's context menu, such as one
   * that opens the host's Display Properties to turn apps back on.
   */
  menuItems?: ReadonlyArray<SystemTrayMenuItem> | undefined;
}

const NO_MENU_ITEMS: ReadonlyArray<SystemTrayMenuItem> = [];

/**
 * The tray apps of the nearest {@link SystemTrayProvider} that the user left
 * on, in order, for a taskbar's corner. Right-clicking one, pressing the
 * context-menu key on it, or holding a finger on it opens its menu: Disable,
 * then the host's `menuItems`. It renders nothing outside a provider.
 */
export function SystemTray({ menuItems = NO_MENU_ITEMS }: SystemTrayProps) {
  const tray = useOptionalSystemTray();
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState();
  const longPress = useLongPress(true);
  if (!tray) {
    return null;
  }

  const { definition, isEnabled, setEnabled } = tray;
  const menuApp = contextMenu ? definition.apps[contextMenu.id] : undefined;

  return (
    <>
      <ul aria-label="System tray" className="system-tray">
        {definition.order.filter(isEnabled).map((id) => {
          const TrayApp = definition.apps[id]?.component;
          return (
            TrayApp && (
              <li
                {...longPress}
                className="system-tray-app"
                key={id}
                onContextMenu={(event) => openContextMenu(event, id)}
              >
                <TrayApp />
              </li>
            )
          );
        })}
      </ul>
      {contextMenu && menuApp && (
        <Menu onClose={closeContextMenu} position={contextMenu.position}>
          <MenuItem
            icon={menuApp.icon}
            label={`Disable ${menuApp.title}`}
            onClick={() => {
              closeContextMenu();
              setEnabled(contextMenu.id, false);
            }}
          />
          {menuItems.map((item) => (
            <MenuItem
              icon={item.icon}
              key={item.id}
              label={item.label}
              onClick={() => {
                closeContextMenu();
                item.onSelect();
              }}
            />
          ))}
        </Menu>
      )}
    </>
  );
}
