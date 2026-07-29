import { afterEach, expect, test } from "bun:test";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DocumentAttachmentSlots } from "./DocumentAttachmentSlots";
import {
  DocumentBlobOpenProvider,
  type DocumentBlobOpenRequest,
} from "./DocumentBlobOpenContext";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";

afterEach(cleanup);

const slots: ReadonlyArray<DocumentAttachmentSlot> = [
  {
    label: "Front Image",
    slotId: "front",
  },
  {
    label: "Back Image",
    slotId: "back",
  },
];

const attachments: ReadonlyArray<DocumentAttachment> = [
  {
    byteLength: 1024,
    mimeType: "image/png",
    name: "front.png",
    slotId: "front",
  },
  {
    byteLength: 2048,
    mimeType: "image/jpeg",
    name: "back.jpg",
    slotId: "back",
  },
];

function renderAttachmentSlots(params?: {
  attachments?: ReadonlyArray<DocumentAttachment>;
  attachmentStorageKeyBySlotId?: Readonly<Record<string, string | undefined>>;
  blobPicker?: Parameters<typeof DocumentAttachmentSlots>[0]["blobPicker"];
  canAttach?: boolean;
  imageUrlBySlotId?: Readonly<Record<string, string | undefined>>;
  onClearAttachment?: (slotId: string) => void;
  onOpenBlob?: (request: DocumentBlobOpenRequest) => void;
}) {
  const slotsElement = (
    <DocumentAttachmentSlots
      attachmentStorageKeyBySlotId={params?.attachmentStorageKeyBySlotId ?? {}}
      attachmentStatusBySlotId={{}}
      attachments={params?.attachments ?? attachments}
      blobPicker={params?.blobPicker}
      canAttach={params?.canAttach ?? true}
      imageUrlBySlotId={params?.imageUrlBySlotId ?? {}}
      onClearAttachment={params?.onClearAttachment ?? (() => undefined)}
      onSelectedAttachment={() => undefined}
      slots={slots}
    />
  );

  return render(
    params?.onOpenBlob ? (
      <DocumentBlobOpenProvider value={{ openBlob: params.onOpenBlob }}>
        {slotsElement}
      </DocumentBlobOpenProvider>
    ) : (
      slotsElement
    ),
  );
}

test("clear image buttons forward the front and back slot ids", () => {
  const clearedSlotIds: string[] = [];
  const view = renderAttachmentSlots({
    onClearAttachment: (slotId) => {
      clearedSlotIds.push(slotId);
    },
  });

  expect(view.getByText("1.0 KB")).toBeTruthy();
  expect(view.getByText("2.0 KB")).toBeTruthy();
  expect(view.getByText("front.png")).toBeTruthy();
  expect(view.getByText("back.jpg")).toBeTruthy();

  fireEvent.click(view.getByRole("button", { name: "Clear Front Image" }));
  fireEvent.click(view.getByRole("button", { name: "Clear Back Image" }));

  expect(clearedSlotIds).toEqual(["front", "back"]);
});

test("clear image buttons are hidden for empty slots", () => {
  const view = renderAttachmentSlots({ attachments: [] });

  expect(view.getAllByText("No image selected")).toHaveLength(2);
  expect(view.queryByText("No file selected")).toBeNull();
  expect(view.queryByRole("button", { name: "Clear Front Image" })).toBeNull();
  expect(view.queryByRole("button", { name: "Clear Back Image" })).toBeNull();
  expect(view.queryByText("Attach an image to bind this slot.")).toBeNull();
});

test("shows downloading feedback when an attachment exists before its image bytes load", () => {
  const view = renderAttachmentSlots({
    attachments: [attachments[0] as DocumentAttachment],
  });

  const frontSlot = view
    .getByText("Front Image")
    .closest(".structured-document-slot");
  expect(frontSlot?.textContent).toContain("Downloading image...");
  expect(frontSlot?.textContent).not.toContain("No image selected");

  const backSlot = view
    .getByText("Back Image")
    .closest(".structured-document-slot");
  expect(backSlot?.textContent).toContain("No image selected");
  expect(backSlot?.textContent).not.toContain("Downloading image...");
});

test("opens the bound blob when a slot image is clicked", () => {
  const openRequests: DocumentBlobOpenRequest[] = [];
  const view = renderAttachmentSlots({
    attachmentStorageKeyBySlotId: {
      front: "front-storage-key",
    },
    imageUrlBySlotId: {
      front: "blob:front-preview",
    },
    onOpenBlob: (request) => openRequests.push(request),
  });

  fireEvent.click(view.getByRole("button", { name: "Open Front Image" }));

  expect(openRequests).toEqual([{ storageKey: "front-storage-key" }]);
});

test("image attachment actions are hidden when attachments cannot be changed", () => {
  const view = renderAttachmentSlots({
    canAttach: false,
    blobPicker: { onRequestBlobPick: () => undefined },
  });

  expect(view.queryAllByRole("button", { name: "Replace Image" })).toEqual([]);
  expect(view.queryAllByRole("button", { name: "Choose Blob" })).toEqual([]);
  expect(view.queryByRole("button", { name: "Clear Front Image" })).toBeNull();
  expect(view.queryByRole("button", { name: "Clear Back Image" })).toBeNull();
});

test("empty image upload actions are hidden when attachments cannot be changed", () => {
  const view = renderAttachmentSlots({
    attachments: [],
    canAttach: false,
    blobPicker: { onRequestBlobPick: () => undefined },
  });

  expect(view.queryAllByRole("button", { name: "Upload Image" })).toEqual([]);
  expect(view.queryAllByRole("button", { name: "Choose Blob" })).toEqual([]);
});
