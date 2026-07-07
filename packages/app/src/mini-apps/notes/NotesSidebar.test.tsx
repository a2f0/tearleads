import { afterEach, expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NotesListHome } from "./NotesSidebar";

afterEach(() => {
  cleanup();
});

const notes: DocumentSummary[] = [
  {
    containerId: "notes-container",
    createdAt: "2026-07-05T12:00:00.000Z",
    documentId: null,
    documentKind: "note",
    id: "note-1",
    title: "Trip plan",
    updatedAt: "2026-07-06T12:00:00.000Z",
  },
];

test("notes list home shows note metadata and drills into a note", () => {
  const selectedNoteIds: string[] = [];
  const view = render(
    <NotesListHome
      handleAreaContextMenu={(event) => event.preventDefault()}
      handleNoteContextMenu={(event) => event.preventDefault()}
      notes={notes}
      ready
      selectedNoteId={null}
      selectNote={(noteId) => selectedNoteIds.push(noteId)}
    />,
  );

  expect(view.getByRole("button", { name: /Trip plan/ })).toBeTruthy();
  expect(view.getByText(/^Modified /)).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: /Trip plan/ }));

  expect(selectedNoteIds).toEqual(["note-1"]);
});
