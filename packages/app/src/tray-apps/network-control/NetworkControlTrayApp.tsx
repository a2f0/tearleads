import { WifiHighIcon } from "@phosphor-icons/react/dist/csr/WifiHigh";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/csr/WifiSlash";
import { Menu, useContextMenuPositionState } from "@tearleads/windowing";
import { useId } from "react";
import { NetworkModeMenuItems } from "../../components/shared/NetworkModeMenuItems";
import { useNetworkState } from "../../providers/api/useNetworkState";

export function NetworkControlTrayApp() {
  const menuId = useId();
  const { mode, online } = useNetworkState();
  const { closeContextMenu, contextMenu, openContextMenuAt } =
    useContextMenuPositionState();
  const Icon = online ? WifiHighIcon : WifiSlashIcon;
  const label = `Network Control: ${online ? "online" : "offline"} (${mode === "automatic" ? "automatic" : "manual"})`;

  return (
    <>
      <button
        aria-expanded={contextMenu !== null}
        aria-controls={contextMenu ? menuId : undefined}
        aria-label={label}
        className="tearleads-action-button tearleads-action-button--icon"
        onClick={(event) => {
          if (contextMenu) {
            closeContextMenu();
          } else {
            const rect = event.currentTarget.getBoundingClientRect();
            openContextMenuAt({ x: rect.left, y: rect.top });
          }
        }}
        onContextMenu={closeContextMenu}
        onMouseDown={
          contextMenu ? (event) => event.stopPropagation() : undefined
        }
        title={label}
        type="button"
      >
        <Icon aria-hidden="true" size={18} />
      </button>
      {contextMenu && (
        <Menu id={menuId} onClose={closeContextMenu} position={contextMenu}>
          <NetworkModeMenuItems onClose={closeContextMenu} />
        </Menu>
      )}
    </>
  );
}
