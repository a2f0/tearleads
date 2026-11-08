import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { useEffect } from "react";
import "./WindowRefreshButton.css";
import { Menu } from "../menu/Menu";
import { MenuItem } from "../menu/MenuItem";
import { useContextMenuState } from "../menu/useContextMenuState";
import { useLongPress } from "../menu/useLongPress";
import type { WindowRefreshMenuItem } from "./windowMenuRegistrations";

const CANCEL_HINT = "Right-click or long-press to cancel.";

/**
 * The registered refresh action shared by floating and routed toolbars. While
 * the refresh runs, a turning ring replaces the icon so a long refresh reads
 * as work in progress rather than as a disabled button. When that refresh can
 * be cancelled, the button stays reachable, though inert to a click, and its
 * context menu (right-click, the context-menu key, or a touch long press)
 * offers Cancel Refresh.
 */
export function WindowRefreshButton({
  className,
  item,
}: {
  className: string;
  item: WindowRefreshMenuItem;
}) {
  const cancel = item.onCancel;
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<"cancel">();
  const longPress = useLongPress(cancel !== null);

  // The refresh can settle while its menu is open; the menu goes with it.
  useEffect(() => {
    if (!cancel) closeContextMenu();
  }, [cancel, closeContextMenu]);

  return (
    <>
      <button
        {...longPress}
        aria-busy={item.refreshing}
        aria-disabled={cancel ? true : undefined}
        aria-haspopup={cancel ? "menu" : undefined}
        aria-label={item.label}
        className={className}
        disabled={cancel ? false : item.disabled}
        title={cancel ? `${item.label} ${CANCEL_HINT}` : item.label}
        type="button"
        onClick={cancel ? undefined : item.onClick}
        onContextMenu={
          cancel ? (event) => openContextMenu(event, "cancel") : undefined
        }
      >
        {item.refreshing ? (
          <RefreshSpinner />
        ) : (
          <ArrowsClockwiseIcon aria-hidden size={18} />
        )}
      </button>
      {contextMenu && cancel && (
        <Menu
          direction="down"
          onClose={closeContextMenu}
          position={contextMenu.position}
        >
          <MenuItem
            label="Cancel Refresh"
            onClick={() => {
              cancel();
              closeContextMenu();
            }}
          />
        </Menu>
      )}
    </>
  );
}

// An open ring on the icon set's 256-unit grid and 16-unit stroke, so each
// toolbar's icon sizing applies to it exactly as to the icon it replaces.
function RefreshSpinner() {
  return (
    <svg
      aria-hidden
      className="window-refresh-spinner"
      height={18}
      viewBox="0 0 256 256"
      width={18}
    >
      <circle
        cx={128}
        cy={128}
        fill="none"
        pathLength={4}
        r={96}
        stroke="currentColor"
        strokeDasharray="3 1"
        strokeLinecap="round"
        strokeWidth={16}
      />
    </svg>
  );
}
