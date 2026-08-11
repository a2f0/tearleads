import { expect, test } from "bun:test";
import { formatNotesRouteSegments, parseNotesRouteSegments } from "./routes";

test("notes route segments cover local and linked note selections", () => {
  expect(parseNotesRouteSegments([])).toBeNull();
  expect(parseNotesRouteSegments(["note", "note-1"])).toEqual({
    noteId: "note-1",
  });
  expect(
    parseNotesRouteSegments([
      "containers",
      "container-1",
      "documents",
      "note-2",
      "remote",
      "document-2",
    ]),
  ).toEqual({
    containerId: "container-1",
    documentId: "document-2",
    noteId: "note-2",
  });
  expect(parseNotesRouteSegments(["unknown", "note-1"])).toBeNull();

  expect(formatNotesRouteSegments(null)).toEqual([]);
  expect(formatNotesRouteSegments({ noteId: "note-1" })).toEqual([
    "note",
    "note-1",
  ]);
  expect(
    formatNotesRouteSegments({
      containerId: "container-1",
      documentId: "document-2",
      noteId: "note-2",
    }),
  ).toEqual([
    "containers",
    "container-1",
    "documents",
    "note-2",
    "remote",
    "document-2",
  ]);
});
