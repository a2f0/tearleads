import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutSimple";
import { CornersOutIcon } from "@phosphor-icons/react/dist/csr/CornersOut";
import { MinusIcon } from "@phosphor-icons/react/dist/csr/Minus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useCallback } from "react";
import { MINI_APP_ICONS } from "../../../mini-apps/registry";
import { Menu } from "../../shared/Menu";
import { MenuItem } from "../../shared/MenuItem";
import { useContextMenuPositionState } from "../../shared/useContextMenuState";
import {
  useWindowActions,
  type WindowEntry,
} from "../../window/WindowStateProvider";

// One taskbar entry. Left click activates the window (restoring it when
// minimized); right click opens the window's own menu, so a minimized window
// can be brought back — or a visible one pushed away — without touching its
// title bar.
export function PaneFooterWindowButton({
  entry,
  active,
}: {
  entry: WindowEntry;
  active: boolean;
}) {
  const { close, maximize, minimize, restore } = useWindowActions();
  const {
    closeContextMenu: closeMenu,
    contextMenu,
    openContextMenuAt,
  } = useContextMenuPositionState();
  const AppIcon = entry.appId ? MINI_APP_ICONS[entry.appId] : undefined;

  const runAndCloseMenu = useCallback(
    (action: (id: string) => void) => () => {
      action(entry.id);
      closeMenu();
    },
    [closeMenu, entry.id],
  );

  return (
    <>
      <button
        type="button"
        className="tearleads-action-button pane-footer-window"
        aria-label={`Activate ${entry.title} window`}
        aria-pressed={active}
        data-minimized={entry.minimized}
        title={entry.title}
        onClick={() => restore(entry.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openContextMenuAt({ x: event.clientX, y: event.clientY });
        }}
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
      {contextMenu && (
        <Menu position={contextMenu} onClose={closeMenu}>
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
