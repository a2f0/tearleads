import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  listExplorerNoteItems,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  openNotes,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

test(
  "notes windows in the same pane share live note state",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);

    await openNotes(view);
    await openNotes(view);

    await waitFor(() => {
      const editors = Array.from(
        view.container.querySelectorAll<HTMLTextAreaElement>(
          "textarea.note-document-editor",
        ),
      );
      expect(editors).toHaveLength(2);
      for (const editor of editors) {
        expect(editor.disabled).toBe(false);
      }
    });

    const noteEditors = view.container.querySelectorAll<HTMLTextAreaElement>(
      "textarea.note-document-editor",
    );
    const firstEditor = noteEditors[0];
    const secondEditor = noteEditors[1];

    invariant(firstEditor, "first editor not found");
    invariant(secondEditor, "second editor not found");

    fireEvent.change(firstEditor, {
      target: { value: "shared pane note" },
    });

    await waitFor(() => {
      expect(firstEditor.value).toBe("shared pane note");
      expect(secondEditor.value).toBe("shared pane note");
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "explorer windows in the same pane share newly created notes without refresh",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);

    const firstExplorer = await openExplorer(view);
    const secondExplorer = await openExplorer(view);

    await waitFor(() => {
      expect(
        listExplorerNoteItems(secondExplorer).some(
          (button) => button.textContent?.trim() === "fresh explorer note",
        ),
      ).toBe(false);
    });

    await openExplorerNewStructuredDocumentRoute(firstExplorer);
    fireEvent.click(
      within(firstExplorer).getByRole("button", { name: "Note" }),
    );

    const editor = await within(firstExplorer).findByRole("textbox", {
      name: /Notes editor/,
    });
    invariant(editor instanceof HTMLTextAreaElement, "note editor not found");

    fireEvent.change(editor, {
      target: { value: "fresh explorer note" },
    });

    await waitFor(() => {
      expect(editor.value).toBe("fresh explorer note");
      expect(
        listExplorerNoteItems(firstExplorer).some(
          (button) => button.textContent?.trim() === "fresh explorer note",
        ),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(
        listExplorerNoteItems(secondExplorer).some(
          (button) => button.textContent?.trim() === "fresh explorer note",
        ),
      ).toBe(true);
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "notes app lists notes created from explorer",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);

    const explorer = await openExplorer(view);

    await openExplorerNewStructuredDocumentRoute(explorer);
    fireEvent.click(within(explorer).getByRole("button", { name: "Note" }));

    const editor = await within(explorer).findByRole("textbox", {
      name: /Notes editor/,
    });
    invariant(editor instanceof HTMLTextAreaElement, "note editor not found");

    fireEvent.change(editor, {
      target: { value: "visible from notes app" },
    });

    await waitFor(() => {
      expect(
        listExplorerNoteItems(explorer).some(
          (button) => button.textContent?.trim() === "visible from notes app",
        ),
      ).toBe(true);
    });

    const notesWindow = await openNotes(view);

    await waitFor(() => {
      expect(
        within(notesWindow).getByRole("button", {
          name: "visible from notes app",
        }),
      ).toBeTruthy();
      const notesEditor = within(notesWindow).getByRole("textbox", {
        name: /Notes editor/,
      });
      invariant(
        notesEditor instanceof HTMLTextAreaElement,
        "notes app editor not found",
      );
      expect(notesEditor.value).toBe("visible from notes app");
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "notes app exposes note creation from the file menu",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);

    const notesWindow = await openNotes(view);

    fireEvent.click(within(notesWindow).getByText("File"));
    const newNoteItem = await within(notesWindow).findByRole("menuitem", {
      name: "New Note",
    });
    fireEvent.click(newNoteItem);

    const editor = await within(notesWindow).findByRole("textbox", {
      name: /Notes editor/,
    });
    invariant(editor instanceof HTMLTextAreaElement, "notes editor not found");

    fireEvent.change(editor, {
      target: { value: "file menu note" },
    });

    await waitFor(() => {
      expect(editor.value).toBe("file menu note");
      expect(
        within(notesWindow).getByRole("button", {
          name: "file menu note",
        }),
      ).toBeTruthy();
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);

test(
  "notes app exposes note creation from the window toolbar",
  async () => {
    const view = renderPane();

    await generateIdentityAndWaitForDb(view);

    const notesWindow = await openNotes(view);

    const newNoteButton = await within(notesWindow).findByRole("button", {
      name: "New Note",
    });
    fireEvent.click(newNoteButton);

    const editor = await within(notesWindow).findByRole("textbox", {
      name: /Notes editor/,
    });
    invariant(editor instanceof HTMLTextAreaElement, "notes editor not found");

    fireEvent.change(editor, {
      target: { value: "toolbar note" },
    });

    await waitFor(() => {
      expect(editor.value).toBe("toolbar note");
      expect(
        within(notesWindow).getByRole("button", {
          name: "toolbar note",
        }),
      ).toBeTruthy();
    });

    view.unmount();
  },
  PANE_ASYNC_TEST_TIMEOUT_MS,
);
