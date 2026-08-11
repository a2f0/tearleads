import { NotePencilIcon } from "@phosphor-icons/react/dist/csr/NotePencil";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { type MouseEvent, useCallback } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import type { ContextMenuState } from "../../../components/shared/useContextMenuState";
import { useMiniAppListContextMenu } from "../../shared/list-panel/useMiniAppListContextMenu";
import { NOTES_LABELS } from "../labels";

export type NotesContextMenuTarget =
  | { kind: "area" }
  | { kind: "note"; noteId: string };

export type NotesContextMenuState = ContextMenuState<NotesContextMenuTarget>;

const AREA_TARGET: NotesContextMenuTarget = { kind: "area" };

function noteTarget(noteId: string): NotesContextMenuTarget {
  return { kind: "note", noteId };
}

export interface NotesContextMenuModel {
  closeContextMenu: () => void;
  contextMenu: NotesContextMenuState | null;
  deleteContextMenuNote: () => Promise<void>;
  handleAreaContextMenu: (event: MouseEvent<HTMLElement>) => void;
  handleNoteContextMenu: (
    event: MouseEvent<HTMLElement>,
    noteId: string,
  ) => void;
}

export function useNotesContextMenu(params: {
  deleteNote: (noteId: string) => Promise<void>;
}): NotesContextMenuModel {
  const { deleteNote } = params;
  const {
    closeContextMenu,
    contextMenu,
    handleAreaContextMenu,
    handleRowContextMenu: handleNoteContextMenu,
  } = useMiniAppListContextMenu({
    areaTarget: AREA_TARGET,
    rowTarget: noteTarget,
  });

  const deleteContextMenuNote = useCallback(async () => {
    if (!contextMenu || contextMenu.id.kind !== "note") {
      return;
    }

    const noteId = contextMenu.id.noteId;
    closeContextMenu();
    await deleteNote(noteId);
  }, [closeContextMenu, contextMenu, deleteNote]);

  return {
    closeContextMenu,
    contextMenu,
    deleteContextMenuNote,
    handleAreaContextMenu,
    handleNoteContextMenu,
  };
}

export function NotesContextMenuLayer(params: {
  closeContextMenu: () => void;
  contextMenu: NotesContextMenuState | null;
  createNote: () => void;
  deleteContextMenuNote: () => Promise<void>;
  ready: boolean;
}) {
  const {
    closeContextMenu,
    contextMenu,
    createNote,
    deleteContextMenuNote,
    ready,
  } = params;

  if (!contextMenu) {
    return null;
  }

  return (
    <Menu
      position={contextMenu.position}
      onClose={closeContextMenu}
      direction="down"
    >
      {contextMenu.id.kind === "area" ? (
        <MenuItem
          icon={NotePencilIcon}
          label={NOTES_LABELS.newNoteAction}
          disabled={!ready}
          onClick={() => {
            closeContextMenu();
            createNote();
          }}
        />
      ) : (
        <MenuItem
          icon={TrashIcon}
          label={NOTES_LABELS.deleteNoteAction}
          onClick={() => {
            void deleteContextMenuNote();
          }}
        />
      )}
    </Menu>
  );
}
