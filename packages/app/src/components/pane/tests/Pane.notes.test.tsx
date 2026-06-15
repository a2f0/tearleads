import { afterEach, expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  cleanupPaneTestEnvironment,
  generateIdentityAndWaitForDb,
  listExplorerNoteItems,
  openExplorer,
  openExplorerNewStructuredDocumentRoute,
  openNotes,
  renderPane,
} from "../../../../test/helpers/paneTestUtils";

afterEach(cleanupPaneTestEnvironment);

test("notes windows in the same pane share live note state", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 120,
    clientY: 120,
  });
  fireEvent.click(view.getByText("Open Notes"));
  fireEvent.contextMenu(view.getByRole("application"), {
    clientX: 160,
    clientY: 160,
  });
  fireEvent.click(view.getByText("Open Notes"));

  await waitFor(() => {
    const editors = Array.from(
      view.container.querySelectorAll<HTMLTextAreaElement>(
        "textarea.notes-editor",
      ),
    );
    expect(editors).toHaveLength(2);
    for (const editor of editors) {
      expect(editor.disabled).toBe(false);
    }
  });

  const noteEditors = view.container.querySelectorAll<HTMLTextAreaElement>(
    "textarea.notes-editor",
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
});

test("explorer windows in the same pane share newly created notes without refresh", async () => {
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
    within(firstExplorer).getByRole("button", { name: "New Note" }),
  );

  await waitFor(() => {
    expect(
      within(firstExplorer).getByRole("button", { name: "Back to Container" }),
    ).toBeTruthy();
  });

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
});

test("notes app lists notes created from explorer", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  const explorer = await openExplorer(view);

  await openExplorerNewStructuredDocumentRoute(explorer);
  fireEvent.click(within(explorer).getByRole("button", { name: "New Note" }));

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
});

test("notes app exposes note creation from the file menu", async () => {
  const view = renderPane();

  await generateIdentityAndWaitForDb(view);

  const notesWindow = await openNotes(view);

  expect(
    within(notesWindow).queryByRole("button", { name: "New Note" }),
  ).toBeNull();

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
});
