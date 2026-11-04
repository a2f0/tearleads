import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import {
  Menu,
  MenuItem,
  useContextMenuState,
  type WindowingIcon,
} from "@tearleads/windowing";
import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../../components/mini-app/rows/MiniAppRow";
import { classNames } from "../../../../components/shared/classNames";
import { MiniAppRowActionsKebab } from "../../../shared/list-panel/MiniAppListPanel";
import { EXPLORER_LABELS } from "../../labels";
import { ExplorerContainerIcon } from "../../shared/ExplorerContainerIcon";

export interface ExplorerInfoContainerAction {
  disabled?: boolean | undefined;
  icon: WindowingIcon;
  id: string;
  label: string;
  onSelect: () => void;
}

/**
 * Opens the container in Explorer through the same selection the sidebar and
 * item list use (a route change in the routed layout). Disabled when the
 * container is not in the local tree, where there is nothing to open.
 */
export function getGoToContainerAction(params: {
  available: boolean;
  containerId: string;
  setSelectedId: (id: string | null) => void;
}): ExplorerInfoContainerAction {
  return {
    disabled: !params.available,
    icon: FolderOpenIcon,
    id: "go-to-container",
    label: EXPLORER_LABELS.infoContainerGoToAction,
    onSelect: () => params.setSelectedId(params.containerId),
  };
}

/** The unbordered list both Links-tab sections render their rows into. */
export function ExplorerInfoContainerList({
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      {...props}
      className={classNames("explorer-linked-container-list", className)}
    />
  );
}

/**
 * One container on a document's Links tab: its icon and name (full id in the
 * title), optional muted metadata, and the row actions menu, opened by the
 * kebab or a right-click on the row in windowed and routed layouts alike.
 */
export function ExplorerInfoContainerRow(params: {
  actions: ReadonlyArray<ExplorerInfoContainerAction>;
  containerId: string;
  icon: string | null | undefined;
  label: string;
  metadata?: ReactNode;
  trailing?: ReactNode;
}) {
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<string>();
  const openMenu = (event: MouseEvent<HTMLElement>) =>
    openContextMenu(event, params.containerId);

  return (
    <MiniAppRow
      as="li"
      className="explorer-linked-container-row"
      onContextMenu={openMenu}
      selected={contextMenu !== null}
    >
      <span className="explorer-item-name" title={params.containerId}>
        <ExplorerContainerIcon
          className="explorer-folder-icon"
          icon={params.icon}
        />
        <MiniAppRowStack>
          <MiniAppRowText>{params.label}</MiniAppRowText>
          {params.metadata ? (
            <MiniAppRowText muted>{params.metadata}</MiniAppRowText>
          ) : null}
        </MiniAppRowStack>
      </span>
      {params.trailing}
      <MiniAppRowActionsKebab
        openContextMenu={openMenu}
        rowName={params.label}
      />
      {contextMenu ? (
        <Menu
          direction="down"
          onClose={closeContextMenu}
          position={contextMenu.position}
        >
          {params.actions.map((action) => (
            <MenuItem
              disabled={action.disabled}
              icon={action.icon}
              key={action.id}
              label={action.label}
              onClick={() => {
                closeContextMenu();
                action.onSelect();
              }}
            />
          ))}
        </Menu>
      ) : null}
    </MiniAppRow>
  );
}
