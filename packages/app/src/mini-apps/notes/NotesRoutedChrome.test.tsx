import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { WindowMenuProvider } from "../../components/window/WindowMenuContext";
import { WindowToolBar } from "../../components/window/WindowToolBar";
import { NOTES_LABELS } from "./labels";
import { useNotesRoutedChromeActions } from "./NotesRoutedChrome";

afterEach(() => cleanup());

// The chrome hook, like its org-manager peer, requires reference-stable
// callbacks — the toolbar re-registers whenever an action's onClick identity
// changes. Keep this at module scope so a harness re-render (which a context
// update triggers) does not hand the hook a fresh closure and loop forever.
const noop = () => undefined;

function NotesRoutedChromeHarness({
  onCreateNote = noop,
  ready = true,
}: {
  onCreateNote?: () => void;
  ready?: boolean;
}) {
  useNotesRoutedChromeActions({ createNote: onCreateNote, ready });

  return <WindowToolBar />;
}

function renderChrome(ui: Parameters<typeof render>[0]) {
  return render(<WindowMenuProvider>{ui}</WindowMenuProvider>);
}

test("exposes the New Note toolbar action", async () => {
  const invoked: string[] = [];
  const view = renderChrome(
    <NotesRoutedChromeHarness onCreateNote={() => invoked.push("new-note")} />,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: NOTES_LABELS.newNoteAction }),
    ).toBeTruthy();
  });

  fireEvent.click(
    view.getByRole("button", { name: NOTES_LABELS.newNoteAction }),
  );
  expect(invoked).toEqual(["new-note"]);
});

test("reserves the toolbar row so it renders even before chrome shows", async () => {
  const view = renderChrome(<NotesRoutedChromeHarness />);

  await waitFor(() => {
    expect(view.container.querySelector(".window-toolbar")).not.toBeNull();
  });
});

test("New Note is disabled until notes are ready", async () => {
  const view = renderChrome(<NotesRoutedChromeHarness ready={false} />);

  await waitFor(() => {
    expect(
      (
        view.getByRole("button", {
          name: NOTES_LABELS.newNoteAction,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
