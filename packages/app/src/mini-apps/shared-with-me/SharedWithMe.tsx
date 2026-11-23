import { FolderUserIcon } from "@phosphor-icons/react/dist/csr/FolderUser";
import { useContextMenuState } from "@tearleads/windowing";
import { useCallback, useEffect } from "react";
import {
  MiniAppRoot,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { useAccountBootstrapProgress } from "../../identity/useAccountBootstrapProgress";
import { useMiniAppBusActions } from "../bus";
import { SharedWithMeContextMenu } from "./context-menu/SharedWithMeContextMenu";
import { useSharedWithMe } from "./hooks/useSharedWithMe";
import { SharedWithMeTable } from "./list/SharedWithMeTable";
import { resolveSharedWithMeSurfaceState } from "./model/sharedWithMeSurfaceState";
import "./SharedWithMe.css";

const EMPTY_ICON = <FolderUserIcon size={40} weight="light" />;

/**
 * Every folder this user can reach, with the organization it came from and
 * their permission on it, independent of which organization is the active
 * workspace. An organization with no folder listed yet still gets a row so its
 * sync and leave choices stay reachable.
 */
export function SharedWithMe() {
  const { ready, rows, syncChoices } = useSharedWithMe();
  const { openMiniApp } = useMiniAppBusActions();
  const openFolder = useCallback(
    (folderId: string) =>
      openMiniApp({ appId: "explorer", pathSegments: ["items", folderId] }),
    [openMiniApp],
  );
  // The menu reads its row from the live list by key, so it reflects choices
  // that settle while it is open; a row that leaves the list takes it along.
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<string>();
  const menuRow = contextMenu
    ? rows.find((row) => row.key === contextMenu.id)
    : undefined;
  const menuRowGone = contextMenu !== null && menuRow === undefined;
  useEffect(() => {
    if (menuRowGone) closeContextMenu();
  }, [closeContextMenu, menuRowGone]);

  const progress = useAccountBootstrapProgress();
  const surfaceState = resolveSharedWithMeSurfaceState({
    progress,
    ready,
    rowCount: rows.length,
  });

  if (surfaceState) {
    return (
      <MiniAppRoot className="shared-with-me">
        <MiniAppStatePanel
          busy={surfaceState.busy}
          description={surfaceState.description}
          icon={EMPTY_ICON}
          title={surfaceState.title}
        />
      </MiniAppRoot>
    );
  }

  return (
    <MiniAppRoot className="shared-with-me">
      {syncChoices.error ? (
        <MiniAppStatus tone="error">{syncChoices.error}</MiniAppStatus>
      ) : null}
      <SharedWithMeTable
        changingOrganizationId={syncChoices.changingOrganizationId}
        contextRowKey={menuRow?.key ?? null}
        onOpenFolder={openFolder}
        onRowContextMenu={openContextMenu}
        rows={rows}
      />
      {contextMenu && menuRow ? (
        <SharedWithMeContextMenu
          onClose={closeContextMenu}
          onOpenFolder={openFolder}
          position={contextMenu.position}
          row={menuRow}
          syncChoices={syncChoices}
        />
      ) : null}
    </MiniAppRoot>
  );
}
