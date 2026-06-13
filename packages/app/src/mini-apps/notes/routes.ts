import type { ActiveNoteSelection } from "./types";

interface NotesRouteSnapshot {
  selection: ActiveNoteSelection | null;
}

const DEFAULT_NOTES_ROUTE_SNAPSHOT: NotesRouteSnapshot = {
  selection: null,
};

export function parseNotesRouteSegments(
  pathSegments: ReadonlyArray<string>,
): NotesRouteSnapshot {
  const [
    firstSegment,
    secondSegment,
    thirdSegment,
    fourthSegment,
    fifthSegment,
    sixthSegment,
  ] = pathSegments;

  if (firstSegment === "note" && secondSegment) {
    return {
      selection: {
        noteId: secondSegment,
      },
    };
  }

  if (
    firstSegment === "containers" &&
    secondSegment &&
    thirdSegment === "documents" &&
    fourthSegment
  ) {
    return {
      selection: {
        containerId: secondSegment,
        ...(fifthSegment === "remote" && sixthSegment
          ? { documentId: sixthSegment }
          : {}),
        noteId: fourthSegment,
      },
    };
  }

  return DEFAULT_NOTES_ROUTE_SNAPSHOT;
}

export function formatNotesRouteSegments(
  selection: ActiveNoteSelection | null,
): ReadonlyArray<string> {
  if (!selection) {
    return [];
  }

  if (selection.containerId) {
    return selection.documentId
      ? [
          "containers",
          selection.containerId,
          "documents",
          selection.noteId,
          "remote",
          selection.documentId,
        ]
      : ["containers", selection.containerId, "documents", selection.noteId];
  }

  return ["note", selection.noteId];
}
