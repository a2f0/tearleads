import { afterEach, expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NOTES_LABELS } from "./labels";
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
      createNote={() => {}}
      handleAreaContextMenu={(event) => event.preventDefault()}
      handleNoteContextMenu={(event) => event.preventDefault()}
      notes={notes}
      ready
      primeVisibleNotes={() => {}}
      selectedNoteId={null}
      selectNote={(noteId) => selectedNoteIds.push(noteId)}
    />,
  );

  const noteRowButton = view
    .getAllByRole("button", { name: /Trip plan/ })
    .find((button) => button.classList.contains("mini-app-row--button"));
  expect(noteRowButton).toBeTruthy();
  expect(view.getByText(/^Modified /)).toBeTruthy();

  fireEvent.click(noteRowButton as HTMLElement);

  expect(selectedNoteIds).toEqual(["note-1"]);
});

test("notes list home offers an empty-state tile that creates the first note", () => {
  let created = 0;
  let areaMenus = 0;
  const view = render(
    <NotesListHome
      createNote={() => {
        created += 1;
      }}
      handleAreaContextMenu={(event) => {
        event.preventDefault();
        areaMenus += 1;
      }}
      handleNoteContextMenu={(event) => event.preventDefault()}
      notes={[]}
      ready
      primeVisibleNotes={() => {}}
      selectedNoteId={null}
      selectNote={() => {}}
    />,
  );

  const emptyTile = view.getByRole("button", {
    name: NOTES_LABELS.sidebarEmptyCreate,
  });
  // The roomy list home has room for the full sentence rather than the rail's
  // action-only label.
  expect(emptyTile.textContent).toBe(NOTES_LABELS.sidebarEmptyCreate);

  fireEvent.click(emptyTile);

  expect(created).toBe(1);

  // The tile covers the whole empty area, so it must not swallow the area
  // context menu the surrounding surface would otherwise open.
  fireEvent.contextMenu(emptyTile);

  expect(areaMenus).toBe(1);
});

test("notes list home shows loading rather than the empty tile before notes load", () => {
  const view = render(
    <NotesListHome
      createNote={() => {}}
      handleAreaContextMenu={(event) => event.preventDefault()}
      handleNoteContextMenu={(event) => event.preventDefault()}
      notes={[]}
      ready={false}
      primeVisibleNotes={() => {}}
      selectedNoteId={null}
      selectNote={() => {}}
    />,
  );

  expect(
    view.queryByRole("button", { name: NOTES_LABELS.sidebarEmptyCreate }),
  ).toBeNull();
  expect(view.getByText(NOTES_LABELS.sidebarLoading)).toBeTruthy();
});

test("content demand follows only visible virtual rows and waits for directory readiness", () => {
  const template = notes[0];
  if (!template) throw new Error("Missing note fixture");
  const directory = Array.from({ length: 1000 }, (_, index) => ({
    ...template,
    id: `note-${index}`,
    documentId: `remote-${index}`,
    title: `Note ${index}`,
  }));
  const demanded: ReadonlyArray<DocumentSummary>[] = [];
  const props = {
    createNote: () => {},
    handleAreaContextMenu: () => {},
    handleNoteContextMenu: () => {},
    notes: directory,
    primeVisibleNotes: (rows: ReadonlyArray<DocumentSummary>) =>
      demanded.push(rows),
    selectedNoteId: null,
    selectNote: () => {},
  };
  const view = render(<NotesListHome {...props} ready={false} />);
  expect(demanded).toEqual([]);
  view.rerender(<NotesListHome {...props} ready />);
  expect(demanded).toHaveLength(1);
  expect(demanded[0]?.map((note) => note.id)).toEqual(
    directory.slice(0, 24).map((note) => note.id),
  );
  view.rerender(<NotesListHome {...props} ready />);
  expect(demanded).toHaveLength(1);
  const frame = view.container.querySelector<HTMLElement>(
    ".mini-app-virtual-list-frame",
  );
  if (!frame) throw new Error("Missing virtual list frame");
  fireEvent.scroll(frame, { target: { scrollTop: 48 * 100 } });
  expect(demanded.at(-1)?.map((note) => note.id)).toEqual(
    directory.slice(92, 116).map((note) => note.id),
  );
});
