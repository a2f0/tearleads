import { NotePencilIcon } from "@phosphor-icons/react/dist/csr/NotePencil";
import { useMemo } from "react";
import {
  useWindowTitleBarAction,
  useWindowToolbarReservation,
} from "../../components/window/WindowMenuContext";
import { NOTES_LABELS } from "./labels";

/**
 * Registers notes' window toolbar chrome. Unlike org-manager's route-scoped
 * actions, "New Note" is available on every notes route — the compact list-home
 * and while a note is open, in both the routed home surface and the floating
 * window — mirroring the always-present "New Note" File-menu item registered in
 * {@link NotesApp}. The reserved row keeps a stable bar height across those
 * routes rather than collapsing when a note opens.
 */
export function useNotesRoutedChromeActions({
  createNote,
  ready,
}: {
  createNote: () => void;
  ready: boolean;
}) {
  // Reserve the toolbar row on every notes route so it renders a stable bar
  // rather than appearing only once chrome first registers.
  useWindowToolbarReservation();

  const newNoteAction = useMemo(
    () => ({
      disabled: !ready,
      icon: <NotePencilIcon aria-hidden size={18} />,
      id: "notes-new-note-toolbar",
      label: NOTES_LABELS.newNoteAction,
      onClick: createNote,
      priority: 100,
    }),
    [createNote, ready],
  );

  useWindowTitleBarAction(newNoteAction);
}
