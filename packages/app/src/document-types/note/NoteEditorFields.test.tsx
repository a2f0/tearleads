import { afterEach, expect, test } from "bun:test";
import type { DocumentAttachment } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { NoteEditorFields } from "./NoteEditorFields";

// The attachment preview overlay opened from these tiles is covered separately
// in NoteAttachmentPreview.test.tsx.

afterEach(cleanup);

function noop() {
  return undefined;
}

type NoteEditorFieldsProps = Parameters<typeof NoteEditorFields>[0];

function buildNoteEditorFields(overrides: Partial<NoteEditorFieldsProps> = {}) {
  const props: NoteEditorFieldsProps = {
    attachments: [],
    attachmentStatusBySlotId: {},
    canAttach: true,
    dragActive: false,
    fileInputId: "note-file-input",
    fileInputRef: createRef<HTMLInputElement>(),
    handleDownloadAttachment: noop,
    handleDragEnter: noop,
    handleDragLeave: noop,
    handleDragOver: noop,
    handleDrop: noop,
    handleRemoveAttachment: noop,
    handleSelectedFiles: noop,
    imageUrlBySlotId: {},
    ready: true,
    readOnly: false,
    setText: noop,
    syncing: false,
    text: "",
    ...overrides,
  };

  return <NoteEditorFields {...props} />;
}

function renderNoteEditorFields(
  overrides: Partial<NoteEditorFieldsProps> = {},
) {
  return render(buildNoteEditorFields(overrides));
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

test("groups attachments and editor inside the shared scroll area", () => {
  const view = renderNoteEditorFields({ attachments: [attachment] });

  const scrollArea = view.container.querySelector(".note-document-scroll");
  expect(scrollArea).toBeTruthy();
  expect(scrollArea?.querySelector(".note-document-dropzone")).toBeTruthy();
  expect(scrollArea?.querySelector(".note-document-editor")).toBeTruthy();
});

test("uses a fieldset dropzone when attachments are interactive", () => {
  const view = renderNoteEditorFields({ attachments: [attachment] });

  const dropzone = view.container.querySelector(".note-document-dropzone");
  expect(dropzone?.tagName).toBe("FIELDSET");
});

test("auto-sizes the editor to its content height", () => {
  const view = renderNoteEditorFields({ text: "first line" });
  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;
  Object.defineProperty(editor, "scrollHeight", {
    configurable: true,
    value: 240,
  });

  view.rerender(
    <NoteEditorFields
      attachments={[]}
      attachmentStatusBySlotId={{}}
      canAttach={true}
      dragActive={false}
      fileInputId="note-file-input"
      fileInputRef={createRef<HTMLInputElement>()}
      handleDownloadAttachment={noop}
      handleDragEnter={noop}
      handleDragLeave={noop}
      handleDragOver={noop}
      handleDrop={noop}
      handleRemoveAttachment={noop}
      handleSelectedFiles={noop}
      imageUrlBySlotId={{}}
      ready={true}
      readOnly={false}
      setText={noop}
      syncing={false}
      text={"first line\nsecond line"}
    />,
  );

  expect(editor.style.height).toBe("240px");
});

test("removing an attachment forwards its slot id after confirmation", () => {
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

  // The trash button only opens the confirm dialog; nothing is removed yet.
  expect(removedSlots).toEqual([]);

  fireEvent.click(view.getByRole("button", { name: "Remove" }));

  expect(removedSlots).toEqual(["slot-1"]);
});

test("cancelling the remove confirmation keeps the attachment", () => {
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
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  expect(removedSlots).toEqual([]);
  // The dialog closes, so its confirm button is gone from the tree.
  expect(view.queryByRole("button", { name: "Remove" })).toBeNull();
});

test("surfaces a syncing attachment status", () => {
  const view = renderNoteEditorFields({
    attachments: [attachment],
    attachmentStatusBySlotId: { "slot-1": "syncing" },
  });

  expect(view.getByText("Syncing")).toBeTruthy();
});

test("shows the attachment count in the section header", () => {
  const second: DocumentAttachment = {
    byteLength: 2048,
    mimeType: "application/pdf",
    name: "spec.pdf",
    slotId: "slot-2",
  };
  const view = renderNoteEditorFields({ attachments: [attachment, second] });

  expect(view.getByText("Attachments · 2")).toBeTruthy();
});

test("labels each attachment with its kind and size", () => {
  const pdf: DocumentAttachment = {
    byteLength: 2048,
    mimeType: "application/pdf",
    name: "spec.pdf",
    slotId: "slot-2",
  };
  const view = renderNoteEditorFields({ attachments: [pdf] });

  expect(view.getByText("PDF · 2.0 KB")).toBeTruthy();
});

test("opening a tile forwards a download request", () => {
  const downloaded: string[] = [];
  const view = renderNoteEditorFields({
    attachments: [attachment],
    handleDownloadAttachment: (slotId) => downloaded.push(slotId),
  });

  fireEvent.click(view.getByRole("button", { name: "Download diagram.png" }));

  expect(downloaded).toEqual(["slot-1"]);
});

test("read-only notes hide the upload and remove affordances", () => {
  const view = renderNoteEditorFields({
    attachments: [attachment],
    handleSelectBlob: () => undefined,
    readOnly: true,
  });

  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
  // The blob picker is suppressed too, even though one was supplied.
  expect(view.queryByRole("button", { name: "Select Blob" })).toBeNull();
  expect(
    view.queryByRole("button", { name: "Remove attachment diagram.png" }),
  ).toBeNull();
  // Download stays available even when the note cannot be edited.
  expect(
    view.getByRole("button", { name: "Download diagram.png" }),
  ).toBeTruthy();
});

test("the upload button opens the shared file input", () => {
  const fileInputRef = createRef<HTMLInputElement>();
  const view = renderNoteEditorFields({ fileInputRef });

  const input = view.container.querySelector(
    "input[type=file]",
  ) as HTMLInputElement;
  let clicks = 0;
  input.click = () => {
    clicks += 1;
  };

  fireEvent.click(view.getByRole("button", { name: "Upload" }));

  expect(clicks).toBe(1);
});

test("hides the select blob button when no blob picker is available", () => {
  const view = renderNoteEditorFields();

  expect(view.queryByRole("button", { name: "Select Blob" })).toBeNull();
  // Upload is always available on an interactive note.
  expect(view.getByRole("button", { name: "Upload" })).toBeTruthy();
});

test("shows the select blob button and forwards its clicks", () => {
  let picks = 0;
  const view = renderNoteEditorFields({
    handleSelectBlob: () => {
      picks += 1;
    },
  });

  fireEvent.click(view.getByRole("button", { name: "Select Blob" }));

  expect(picks).toBe(1);
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

test("focuses the editor body when the note becomes ready", () => {
  const view = renderNoteEditorFields({ ready: false, text: "loaded note" });
  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;
  expect(document.activeElement).not.toBe(editor);

  view.rerender(buildNoteEditorFields({ ready: true, text: "loaded note" }));

  expect(document.activeElement).toBe(editor);
  // Caret lands at the end so the user can keep writing immediately.
  expect(editor.selectionStart).toBe("loaded note".length);
  expect(editor.selectionEnd).toBe("loaded note".length);
});

test("focuses the editor body when a ready note mounts", () => {
  const view = renderNoteEditorFields({ ready: true });
  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;

  expect(document.activeElement).toBe(editor);
});

test("does not focus a read-only note", () => {
  const view = renderNoteEditorFields({ ready: false, readOnly: true });
  const editor = view.container.querySelector(
    ".note-document-editor",
  ) as HTMLTextAreaElement;

  view.rerender(buildNoteEditorFields({ ready: true, readOnly: true }));

  expect(document.activeElement).not.toBe(editor);
});

test("focuses when a ready note becomes writable", () => {
  const view = renderNoteEditorFields({ ready: true, readOnly: true });
  const editor = view.getByLabelText(
    "Notes editor read only",
  ) as HTMLTextAreaElement;
  expect(document.activeElement).not.toBe(editor);

  view.rerender(buildNoteEditorFields({ ready: true, readOnly: false }));

  expect(document.activeElement).toBe(editor);
});

test("preserves the caret when text changes externally before it", () => {
  const view = renderNoteEditorFields({ text: "hello world" });
  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;

  editor.focus();
  editor.setSelectionRange(5, 5);
  fireEvent.select(editor);

  // A remote merge inserts "XX" at the start while the caret sits after
  // "hello". The caret must shift right by the two inserted characters instead
  // of snapping to the end of the rewritten value.
  view.rerender(buildNoteEditorFields({ text: "XXhello world" }));

  expect(editor.value).toBe("XXhello world");
  expect(editor.selectionStart).toBe(7);
  expect(editor.selectionEnd).toBe(7);
});

test("leaves the caret in place when external text is appended after it", () => {
  const view = renderNoteEditorFields({ text: "hello world" });
  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;

  editor.focus();
  editor.setSelectionRange(5, 5);
  fireEvent.select(editor);

  // An insert entirely after the caret must not move it.
  view.rerender(buildNoteEditorFields({ text: "hello world!!" }));

  expect(editor.value).toBe("hello world!!");
  expect(editor.selectionStart).toBe(5);
});

test("does not remap the caret for the user's own edits", () => {
  const changes: string[] = [];
  const view = renderNoteEditorFields({
    text: "hello",
    setText: (next) => changes.push(next),
  });
  const editor = view.getByLabelText("Notes editor") as HTMLTextAreaElement;

  editor.focus();
  // The user types "X" at the end; onChange reports the new value and caret.
  fireEvent.change(editor, {
    target: { value: "helloX", selectionStart: 6, selectionEnd: 6 },
  });
  // The parent echoes the optimistic value straight back (synchronous publish).
  view.rerender(buildNoteEditorFields({ text: "helloX", setText: noop }));

  expect(changes).toEqual(["helloX"]);
  expect(editor.selectionStart).toBe(6);
});
