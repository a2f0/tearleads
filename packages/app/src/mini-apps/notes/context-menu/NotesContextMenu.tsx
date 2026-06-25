import { type MouseEvent, useCallback } from "react";
import { Menu } from "../../../components/shared/Menu";
import { MenuItem } from "../../../components/shared/MenuItem";
import {
  type ContextMenuState,
  useContextMenuState,
} from "../../../components/shared/useContextMenuState";
import { NOTES_LABELS } from "../labels";

export type NotesContextMenuTarget =
  | { kind: "area" }
  | { kind: "note"; noteId: string };

export type NotesContextMenuState = ContextMenuState<NotesContextMenuTarget>;

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
  const { closeContextMenu, contextMenu, openContextMenu } =
    useContextMenuState<NotesContextMenuTarget>();

  const handleAreaContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      openContextMenu(event, { kind: "area" });
    },
    [openContextMenu],
  );

  const handleNoteContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, noteId: string) => {
      openContextMenu(event, { kind: "note", noteId });
    },
    [openContextMenu],
  );

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
          label={NOTES_LABELS.newNoteAction}
          disabled={!ready}
          onClick={() => {
            closeContextMenu();
            createNote();
          }}
        />
      ) : (
        <MenuItem
          label={NOTES_LABELS.deleteNoteAction}
          onClick={() => {
            void deleteContextMenuNote();
          }}
        />
      )}
    </Menu>
  );
}
