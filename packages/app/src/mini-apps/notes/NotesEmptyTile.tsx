import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { MouseEvent } from "react";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { getMiniAppVirtualFrameStyle } from "../../components/mini-app/virtual/MiniAppVirtual";
import { useTouchRowHeight } from "../../navigation/useTouchRowHeight";
import { NOTES_LABELS } from "./labels";
import "./NotesEmptyTile.css";

/**
 * The bootstrap state for a workspace with no notes yet: a dashed stand-in for
 * the note tile that isn't there, sized to the surface's own list pitch (28px in
 * the sidebar rail, 48px in the mobile list home, and the 44px touch floor in
 * the routed layout) so an empty list reads at the same rhythm as a populated
 * one.
 *
 * It needs no `ready` gate — the list only takes its empty branch once the notes
 * directory has loaded — and no pending state, because `createNote` is
 * synchronous and cannot fail.
 */
export function NotesEmptyTile({
  createNote,
  onContextMenu,
  rowHeight,
  showFullLabel,
}: {
  createNote: () => void;
  // The tile covers the surface's whole empty area, and the list's area
  // context-menu handler ignores events over a `.mini-app-row`. Taking the
  // handler directly keeps the area menu (and, via useLongPress, its touch
  // long-press) reachable rather than leaving a dead zone.
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  rowHeight: number;
  showFullLabel: boolean;
}) {
  // Match the pitch the virtual list would have used for a real note row,
  // including the routed layout's touch floor.
  const touchRowHeight = useTouchRowHeight(rowHeight);

  return (
    <MiniAppRowButton
      // The rail truncates the full sentence mid-word, so it shows the action
      // alone and keeps the sentence as its accessible name (which still
      // contains the visible label).
      aria-label={NOTES_LABELS.sidebarEmptyCreate}
      className="notes-empty-tile"
      onClick={createNote}
      onContextMenu={onContextMenu}
      style={getMiniAppVirtualFrameStyle(touchRowHeight)}
    >
      <PlusIcon aria-hidden size={16} />
      <MiniAppRowText>
        {showFullLabel
          ? NOTES_LABELS.sidebarEmptyCreate
          : NOTES_LABELS.sidebarEmptyCreateShort}
      </MiniAppRowText>
    </MiniAppRowButton>
  );
}
