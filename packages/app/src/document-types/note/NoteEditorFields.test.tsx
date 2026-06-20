import { afterEach, expect, test } from "bun:test";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { NoteEditorFields } from "./NoteEditorFields";

afterEach(cleanup);

function noop() {
  return undefined;
}

type NoteEditorFieldsProps = Parameters<typeof NoteEditorFields>[0];

function renderNoteEditorFields(
  overrides: Partial<NoteEditorFieldsProps> = {},
) {
  const props: NoteEditorFieldsProps = {
    attachments: [],
    attachmentStatusBySlotId: {},
    canAttach: true,
    dragActive: false,
    fileInputId: "note-file-input",
    fileInputRef: createRef<HTMLInputElement>(),
    handleDragEnter: noop,
    handleDragLeave: noop,
    handleDragOver: noop,
    handleDrop: noop,
    handleRemoveAttachment: noop,
    handleSelectedFiles: noop,
    imageUrlBySlotId: {},
    ready: true,
    setText: noop,
    syncing: false,
    text: "",
    ...overrides,
  };

  return render(<NoteEditorFields {...props} />);
}

const attachment: DocumentAttachment = {
  byteLength: 1024,
  mimeType: "image/png",
  name: "diagram.png",
  slotId: "slot-1",
};

test("renders the editor seeded with the note text", () => {
  const view = renderNoteEditorFields({ text: "hello world" });

  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;
  expect(editor.value).toBe("hello world");
});

test("editor edits flow through setText", () => {
  const changes: string[] = [];
  const view = renderNoteEditorFields({
    setText: (next) => changes.push(next),
  });

  fireEvent.change(view.getByLabelText("Notes editor"), {
    target: { value: "drafted" },
  });

  expect(changes).toEqual(["drafted"]);
});

test("shows the empty attachments state when there are none", () => {
  const view = renderNoteEditorFields();

  expect(view.getByText("No attachments yet.")).toBeTruthy();
});

test("lists attachments with their byte size", () => {
  const view = renderNoteEditorFields({ attachments: [attachment] });

  expect(view.getByText("diagram.png")).toBeTruthy();
  expect(view.queryByText("No attachments yet.")).toBeNull();
});

test("removing an attachment forwards its slot id", () => {
  const removedSlots: string[] = [];
  const view = renderNoteEditorFields({
    attachments: [attachment],
    handleRemoveAttachment: (slotId) => {
      removedSlots.push(slotId);
    },
  });

  fireEvent.click(
    view.getByRole("button", { name: "Remove attachment diagram.png" }),
  );

  expect(removedSlots).toEqual(["slot-1"]);
});

test("surfaces a syncing attachment status", () => {
  const view = renderNoteEditorFields({
    attachments: [attachment],
    attachmentStatusBySlotId: { "slot-1": "syncing" },
  });

  expect(view.getByText("Syncing attachment.")).toBeTruthy();
});

test("selecting files forwards them to handleSelectedFiles", () => {
  let received: FileList | null = null;
  const view = renderNoteEditorFields({
    handleSelectedFiles: (fileList) => {
      received = fileList;
    },
  });

  const input = view.container.querySelector(
    "input[type=file]",
  ) as HTMLInputElement;
  const file = new File(["bytes"], "note.txt", { type: "text/plain" });
  fireEvent.change(input, { target: { files: [file] } });

  expect(received).not.toBeNull();
  expect((received as unknown as FileList)[0]?.name).toBe("note.txt");
});

test("renders the optional toolbar slot", () => {
  const view = renderNoteEditorFields({
    toolbar: <button type="button">Attach File</button>,
  });

  expect(view.getByText("Attach File")).toBeTruthy();
});

test("editor is disabled until the document is ready", () => {
  const view = renderNoteEditorFields({ ready: false });

  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;
  expect(editor.disabled).toBe(true);
});
