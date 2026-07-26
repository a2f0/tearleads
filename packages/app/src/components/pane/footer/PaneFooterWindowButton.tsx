import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutSimple";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useCallback, useState } from "react";
import { MINI_APP_ICONS } from "../../../mini-apps/registry";
import type { MenuPosition } from "../../shared/Menu";
import { Menu } from "../../shared/Menu";
import { MenuItem } from "../../shared/MenuItem";
import {
  useWindowActions,
  type WindowEntry,
} from "../../window/WindowStateProvider";

// One taskbar entry. Left click activates the window (restoring it when
// minimized); right click opens the window's own menu, so a minimized window
// can be brought back — or a visible one pushed away — without touching its
// title bar.
export function PaneFooterWindowButton({ entry }: { entry: WindowEntry }) {
  const { close, maximize, minimize, restore } = useWindowActions();
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const AppIcon = entry.appId ? MINI_APP_ICONS[entry.appId] : undefined;

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const runAndCloseMenu = useCallback(
    (action: (id: string) => void) => () => {
      action(entry.id);
      setMenu(null);
    },
    [entry.id],
  );

  return (
    <>
      <button
        type="button"
        className="tearleads-action-button pane-footer-window"
        aria-label={`Activate ${entry.title} window`}
        title={entry.title}
        onClick={() => restore(entry.id)}
        onContextMenu={handleContextMenu}
      >
        {AppIcon && (
          <AppIcon
            aria-hidden="true"
            className="pane-footer-window-icon"
            focusable="false"
            size={16}
            weight="regular"
          />
        )}
        <span className="pane-footer-window-label">{entry.title}</span>
      </button>
      {menu && (
        <Menu position={menu} onClose={closeMenu}>
          {entry.minimized ? (
            <>
              <MenuItem
                icon={ArrowsOutSimpleIcon}
                label="Restore"
                onClick={runAndCloseMenu(restore)}
              />
              <MenuItem
                icon={CornersOutIcon}
                label="Maximize"
                onClick={runAndCloseMenu(maximize)}
              />
            </>
          ) : (
            <MenuItem
              icon={MinusIcon}
              label="Minimize"
              onClick={runAndCloseMenu(minimize)}
            />
          )}
          <MenuItem
            icon={XIcon}
            label="Close"
            onClick={runAndCloseMenu(close)}
          />
        </Menu>
      )}
    </>
  );
}
