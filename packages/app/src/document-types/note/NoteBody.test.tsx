import { afterEach, expect, test } from "bun:test";
import type { DocumentStore } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DocumentContext } from "../../stores/documents/DocumentsProvider";
import { NoteBody } from "./NoteBody";

afterEach(cleanup);

function noteBody(store: DocumentStore, text: string) {
  return (
    <DocumentContext.Provider value={store}>
      <NoteBody
        ready
        readOnly={false}
        setText={() => undefined}
        syncing={false}
        text={text}
      />
    </DocumentContext.Provider>
  );
}

// The editor stays mounted while the store under it swaps. A note opened
// earlier keeps its store, already ready, so switching back to it has no ready
// edge; the switch itself focuses the end of its text and scrolls to it, even
// though the editor already had focus and the caret sat at the start.
test("switching to another loaded note focuses the end of its text", () => {
  const first = {} as DocumentStore;
  const second = {} as DocumentStore;
  const view = render(noteBody(first, "the first note"));
  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;
  expect(document.activeElement).toBe(editor);
  editor.setSelectionRange(0, 0);
  fireEvent.select(editor);
  Object.defineProperty(editor, "scrollHeight", { value: 640 });
  editor.scrollTop = 0;

  view.rerender(noteBody(second, "a longer second note"));

  expect(document.activeElement).toBe(editor);
  expect(editor.selectionStart).toBe("a longer second note".length);
  expect(editor.selectionEnd).toBe("a longer second note".length);
  expect(editor.scrollTop).toBe(640);

  // The same note keeps the user's caret and scroll across its own renders.
  editor.setSelectionRange(2, 2);
  fireEvent.select(editor);
  editor.scrollTop = 10;
  view.rerender(noteBody(second, "a longer second note"));
  expect(editor.selectionStart).toBe(2);
  expect(editor.scrollTop).toBe(10);
});
