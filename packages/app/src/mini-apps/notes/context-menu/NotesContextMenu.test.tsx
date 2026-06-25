import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useState } from "react";
import { NOTES_LABELS } from "../labels";
import {
  NotesContextMenuLayer,
  type NotesContextMenuState,
  useNotesContextMenu,
} from "./NotesContextMenu";

afterEach(() => cleanup());

function NotesContextMenuLayerHarness(params: {
  contextMenu: NotesContextMenuState;
  createNote?: (() => void) | undefined;
  deleteContextMenuNote?: (() => Promise<void>) | undefined;
  ready?: boolean | undefined;
}) {
  const [contextMenu, setContextMenu] = useState<NotesContextMenuState | null>(
    params.contextMenu,
  );

  return (
    <NotesContextMenuLayer
      closeContextMenu={() => setContextMenu(null)}
      contextMenu={contextMenu}
      createNote={params.createNote ?? (() => undefined)}
      deleteContextMenuNote={
        params.deleteContextMenuNote ?? (async () => undefined)
      }
      ready={params.ready ?? true}
    />
  );
}

function NotesContextMenuModelHarness(params: {
  deleteNote: (noteId: string) => Promise<void>;
}) {
  const model = useNotesContextMenu({ deleteNote: params.deleteNote });

  return (
    <>
      <button
        type="button"
        onContextMenu={(event: ReactMouseEvent<HTMLElement>) =>
          model.handleNoteContextMenu(event, "note-1")
        }
      >
        Note row
      </button>
      <NotesContextMenuLayer
        closeContextMenu={model.closeContextMenu}
        contextMenu={model.contextMenu}
        createNote={() => undefined}
        deleteContextMenuNote={model.deleteContextMenuNote}
        ready
      />
    </>
  );
}

test("notes area context menu creates a note", () => {
  let createNoteCount = 0;
  const view = render(
    <NotesContextMenuLayerHarness
      contextMenu={{ id: { kind: "area" }, position: { x: 12, y: 34 } }}
      createNote={() => {
        createNoteCount += 1;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: NOTES_LABELS.newNoteAction }),
  );

  expect(createNoteCount).toBe(1);
  expect(
    view.queryByRole("button", { name: NOTES_LABELS.newNoteAction }),
  ).toBeNull();
});

test("notes area context menu disables new note until ready", () => {
  const view = render(
    <NotesContextMenuLayerHarness
      contextMenu={{ id: { kind: "area" }, position: { x: 12, y: 34 } }}
      ready={false}
    />,
  );

  expect(
    (
      view.getByRole("button", {
        name: NOTES_LABELS.newNoteAction,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

test("notes row context menu deletes the note", () => {
  let deleteCount = 0;
  const view = render(
    <NotesContextMenuLayerHarness
      contextMenu={{
        id: { kind: "note", noteId: "note-1" },
        position: { x: 12, y: 34 },
      }}
      deleteContextMenuNote={async () => {
        deleteCount += 1;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: NOTES_LABELS.deleteNoteAction }),
  );

  expect(deleteCount).toBe(1);
});

test("notes context menu model deletes the targeted note", async () => {
  const deletedNoteIds: string[] = [];
  const view = render(
    <NotesContextMenuModelHarness
      deleteNote={async (noteId) => {
        deletedNoteIds.push(noteId);
      }}
    />,
  );

  fireEvent.contextMenu(view.getByRole("button", { name: "Note row" }));
  fireEvent.click(
    await view.findByRole("button", { name: NOTES_LABELS.deleteNoteAction }),
  );

  await waitFor(() => {
    expect(deletedNoteIds).toEqual(["note-1"]);
  });
});
