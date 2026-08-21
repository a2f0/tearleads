import { afterEach, expect, test } from "bun:test";
import type { DocumentAttachment } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createRef } from "react";
import { NoteEditorFields } from "./NoteEditorFields";

// The preview is opened from a tile inside NoteEditorFields, so it is exercised
// through that harness (rather than mounted alone) to cover the tile → overlay →
// focus-restore path end to end.

afterEach(cleanup);
afterEach(() => {
  // The preview keys its chrome off this attribute; clear it so a windowed test
  // never bleeds into the routed/default cases that follow.
  document.documentElement.removeAttribute("data-navigation-mode");
});

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

// A type the full-screen image viewer cannot draw, so it exercises the panel
// preview's own chrome rather than being routed away from it.
const documentAttachment: DocumentAttachment = {
  byteLength: 2048,
  mimeType: "application/pdf",
  name: "spec.pdf",
  slotId: "slot-2",
};

test("opening an image tile reveals the full-screen viewer", () => {
  const view = renderNoteEditorFields({
    attachments: [attachment],
    imageUrlBySlotId: { "slot-1": "blob:preview" },
  });

  fireEvent.click(view.getByRole("button", { name: "Open diagram.png" }));

  const dialog = view.getByRole("dialog");
  expect(dialog.classList.contains("mini-app-image-viewer")).toBe(true);
  expect(within(dialog).getByAltText("diagram.png").getAttribute("src")).toBe(
    "blob:preview",
  );
  // The panel preview's chrome is not what opened.
  expect(dialog.querySelector(".note-attachment-preview-bar")).toBeNull();

  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
});

test("the viewer downloads the attachment it is showing", () => {
  const downloaded: string[] = [];
  const view = renderNoteEditorFields({
    attachments: [attachment],
    handleDownloadAttachment: (slotId: string) => downloaded.push(slotId),
    imageUrlBySlotId: { "slot-1": "blob:preview" },
  });

  fireEvent.click(view.getByRole("button", { name: "Open diagram.png" }));
  const dialog = view.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));

  expect(downloaded).toEqual(["slot-1"]);
});

// An image whose bytes have not arrived yet has no URL to hand the viewer, so it
// falls back to the panel — which is the surface that can say so.
test("an image with no local bytes yet keeps the panel preview", () => {
  const view = renderNoteEditorFields({ attachments: [attachment] });

  fireEvent.click(view.getByRole("button", { name: "Open diagram.png" }));

  const dialog = view.getByRole("dialog");
  expect(dialog.classList.contains("mini-app-image-viewer")).toBe(false);
  expect(
    within(dialog).getByText("No preview available for this file type."),
  ).toBeTruthy();
});

test("closing the preview overlay dismisses it", () => {
  const view = renderNoteEditorFields({ attachments: [documentAttachment] });

  fireEvent.click(view.getByRole("button", { name: "Open spec.pdf" }));
  expect(view.queryByRole("dialog")).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Close preview" }));
  expect(view.queryByRole("dialog")).toBeNull();
});

test("dresses the preview as a floating window in windowed mode", () => {
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  const view = renderNoteEditorFields({ attachments: [documentAttachment] });

  fireEvent.click(view.getByRole("button", { name: "Open spec.pdf" }));

  const dialog = view.getByRole("dialog");
  // Window chrome: the window manager's own title bar over its compact toolbar
  // in place of the routed single bar, and the heavier window frame on the panel.
  expect(
    dialog.classList.contains("note-attachment-preview-panel--windowed"),
  ).toBe(true);
  expect(dialog.querySelector(".window-titlebar")).toBeTruthy();
  expect(dialog.querySelector(".window-toolbar")).toBeTruthy();
  expect(dialog.querySelector(".note-attachment-preview-bar")).toBeNull();
  // The actions still resolve by their accessible names within the window
  // (scoped past the tile's own hover download tool of the same name).
  const actions = within(dialog);
  expect(
    actions.getByRole("button", { name: "Download spec.pdf" }),
  ).toBeTruthy();
  expect(
    actions.getByRole("button", { name: "Remove attachment spec.pdf" }),
  ).toBeTruthy();
  expect(actions.getByRole("button", { name: "Close preview" })).toBeTruthy();
});

test("keeps the compact single bar in the routed shell", () => {
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  const view = renderNoteEditorFields({ attachments: [documentAttachment] });

  fireEvent.click(view.getByRole("button", { name: "Open spec.pdf" }));

  const dialog = view.getByRole("dialog");
  expect(dialog.querySelector(".note-attachment-preview-bar")).toBeTruthy();
  expect(dialog.querySelector(".window-toolbar")).toBeNull();
  expect(
    dialog.classList.contains("note-attachment-preview-panel--windowed"),
  ).toBe(false);
});

test("windowed preview close moves focus into the title bar and dismisses", () => {
  document.documentElement.setAttribute("data-navigation-mode", "windowed");
  const view = renderNoteEditorFields({ attachments: [documentAttachment] });
  const openButton = view.getByRole("button", { name: "Open spec.pdf" });

  openButton.focus();
  fireEvent.click(openButton);
  // Focus lands on the title bar's close button (the window manager's own
  // `.window-close`) while the window is open.
  const closeButton = view.getByRole("button", { name: "Close preview" });
  expect(closeButton.classList.contains("window-close")).toBe(true);
  expect(document.activeElement).toBe(closeButton);

  fireEvent.click(closeButton);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(openButton);
});

test("closing the preview restores focus to the opening tile", () => {
  const view = renderNoteEditorFields({ attachments: [documentAttachment] });
  const openButton = view.getByRole("button", { name: "Open spec.pdf" });

  openButton.focus();
  fireEvent.click(openButton);
  // Focus moves into the overlay while it is open.
  const closeButton = view.getByRole("button", { name: "Close preview" });
  expect(document.activeElement).toBe(closeButton);

  fireEvent.click(closeButton);
  // ...and returns to the tile that opened it once it closes.
  expect(document.activeElement).toBe(openButton);
});
