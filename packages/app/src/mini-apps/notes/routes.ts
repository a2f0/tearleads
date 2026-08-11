import type { ActiveNoteSelection } from "./types";

export function parseNotesRouteSegments(
  pathSegments: ReadonlyArray<string>,
): ActiveNoteSelection | null {
  const [
    firstSegment,
    secondSegment,
    thirdSegment,
    fourthSegment,
    fifthSegment,
    sixthSegment,
  ] = pathSegments;

  if (firstSegment === "note" && secondSegment) {
    return { noteId: secondSegment };
  }

  if (
    firstSegment === "containers" &&
    secondSegment &&
    thirdSegment === "documents" &&
    fourthSegment
  ) {
    return {
      containerId: secondSegment,
      ...(fifthSegment === "remote" && sixthSegment
        ? { documentId: sixthSegment }
        : {}),
      noteId: fourthSegment,
    };
  }

  return null;
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
