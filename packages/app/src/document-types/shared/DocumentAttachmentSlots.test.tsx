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
    contentSha256: "1".repeat(64),
    byteLength: 1024,
    mimeType: "image/png",
    name: "front.png",
    slotId: "front",
  },
  {
    contentSha256: "1".repeat(64),
    byteLength: 2048,
    mimeType: "image/jpeg",
    name: "back.jpg",
    slotId: "back",
  },
];

function renderAttachmentSlots(params?: {
  slots?: ReadonlyArray<DocumentAttachmentSlot>;
  attachments?: ReadonlyArray<DocumentAttachment>;
  attachmentStorageKeyBySlotId?: Readonly<Record<string, string | undefined>>;
  blobPicker?: Parameters<typeof DocumentAttachmentSlots>[0]["blobPicker"];
  canAttach?: boolean;
  imageUrlBySlotId?: Readonly<Record<string, string | undefined>>;
  isEditing?: boolean;
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
      isEditing={params?.isEditing ?? params?.canAttach ?? true}
      onClearAttachment={params?.onClearAttachment ?? (() => undefined)}
      onSelectedAttachment={() => undefined}
      slots={params?.slots ?? slots}
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

test("a photo collection renders, opens, and clears each image independently", () => {
  const cleared: string[] = [];
  const opened: DocumentBlobOpenRequest[] = [];
  const view = renderAttachmentSlots({
    slots: [{ label: "Photos", slotId: "photos", multiple: true }],
    attachments: attachments.map((attachment, index) => ({
      ...attachment,
      slotId: `photos:${index}`,
    })),
    attachmentStorageKeyBySlotId: { "photos:0": "first", "photos:1": "second" },
    imageUrlBySlotId: { "photos:0": "blob:first", "photos:1": "blob:second" },
    onClearAttachment: (slotId) => cleared.push(slotId),
    onOpenBlob: (request) => opened.push(request),
  });
  expect(view.container.querySelectorAll("img")).toHaveLength(2);
  expect(view.getByLabelText("Photos").hasAttribute("multiple")).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Open Photos 2" }));
  fireEvent.click(view.getByRole("button", { name: "Clear Photos 1" }));
  expect(opened).toEqual([{ storageKey: "second" }]);
  expect(cleared).toEqual(["photos:0"]);
  expect(view.getByRole("button", { name: "Add Photos" })).toBeTruthy();
});

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

test("shows which image is waiting for bytes without implying an active transfer", () => {
  const view = renderAttachmentSlots({
    attachments: [attachments[0] as DocumentAttachment],
  });

  const frontSlot = view
    .getByText("Front Image")
    .closest(".structured-document-slot");
  expect(frontSlot?.textContent).toContain("Waiting for image bytes");
  expect(
    frontSlot
      ?.querySelector(".structured-document-slot-placeholder")
      ?.getAttribute("aria-busy"),
  ).toBeNull();
  expect(frontSlot?.textContent).not.toContain("No image selected");

  const backSlot = view
    .getByText("Back Image")
    .closest(".structured-document-slot");
  expect(backSlot?.textContent).toContain("No image selected");
  expect(backSlot?.textContent).not.toContain("Waiting for image bytes");
});

test("a locally bound image without a preview remains openable", () => {
  const opened: DocumentBlobOpenRequest[] = [];
  const view = renderAttachmentSlots({
    attachmentStorageKeyBySlotId: { front: "held" },
    onOpenBlob: (request) => opened.push(request),
  });
  const button = view.getByRole("button", {
    name: "Open Front Image",
    description: "No image preview",
  });
  fireEvent.click(button);
  expect(opened).toEqual([{ storageKey: "held" }]);
  expect(view.getByText("Waiting for image bytes")).toBeTruthy();
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

test("photo collection actions and append card are hidden in read mode", () => {
  const view = renderAttachmentSlots({
    canAttach: false,
    slots: [{ label: "Photos", slotId: "photos", multiple: true }],
    attachments: attachments.map((attachment, index) => ({
      ...attachment,
      slotId: `photos:${index}`,
    })),
    blobPicker: { onRequestBlobPick: () => undefined },
  });

  expect(
    view.container.querySelectorAll(".structured-document-slot"),
  ).toHaveLength(2);
  expect(view.queryByRole("button", { name: "Add Photos" })).toBeNull();
  expect(view.queryAllByRole("button", { name: "Replace Image" })).toEqual([]);
  expect(view.queryAllByRole("button", { name: "Choose Blob" })).toEqual([]);
  expect(view.queryByRole("button", { name: "Clear Photos 1" })).toBeNull();
  expect(view.queryByRole("button", { name: "Clear Photos 2" })).toBeNull();
});

test("an empty photo collection is listed only while editing", () => {
  const photos = { label: "Photos", slotId: "photos", multiple: true };
  const receipt = { label: "Receipt", slotId: "receipt" };
  const empty = { attachments: [], canAttach: false };

  // A reader has nothing to append to, so the collection leaves no card, and
  // a document with no other slot leaves no row at all.
  const reading = renderAttachmentSlots({ ...empty, slots: [photos] });
  expect(reading.container.childElementCount).toBe(0);
  reading.unmount();

  const readingWithReceipt = renderAttachmentSlots({
    ...empty,
    slots: [photos, receipt],
  });
  expect(readingWithReceipt.queryByText("Photos")).toBeNull();
  expect(readingWithReceipt.getByText("Receipt")).toBeTruthy();
  readingWithReceipt.unmount();

  // While editing, the card holds its place until attaching becomes possible.
  const editing = renderAttachmentSlots({
    ...empty,
    isEditing: true,
    slots: [photos],
  });
  expect(editing.getByText("Photos")).toBeTruthy();
  expect(editing.getByText("No image selected")).toBeTruthy();
  expect(editing.queryByRole("button", { name: "Add Photos" })).toBeNull();
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

test("stored single-image actions remain hidden in read mode", () => {
  const view = renderAttachmentSlots({ canAttach: false });
  expect(view.getByText("front.png")).toBeTruthy();
  expect(view.queryByRole("button", { name: "Clear Front Image" })).toBeNull();
  expect(view.queryByRole("button", { name: "Replace Image" })).toBeNull();
});

test("an unavailable image says so and retries its download", () => {
  let retries = 0;
  const view = render(
    <DocumentAttachmentSlots
      attachmentStorageKeyBySlotId={{ back: "blob-back" }}
      attachmentStatusBySlotId={{ front: "unavailable" }}
      attachments={attachments}
      canAttach={false}
      imageUrlBySlotId={{}}
      isEditing={false}
      onClearAttachment={() => undefined}
      onRetryDownload={() => {
        retries += 1;
      }}
      onSelectedAttachment={() => undefined}
      slots={slots}
    />,
  );

  expect(view.getByText("Image unavailable")).toBeTruthy();
  expect(
    view.getByText("Image missing or damaged on this device."),
  ).toBeTruthy();
  // Retrying needs no write access: it only fetches the recorded file again.
  fireEvent.click(
    view.getByRole("button", { name: "Retry download of Front Image" }),
  );
  expect(retries).toBe(1);
  expect(
    view.queryByRole("button", { name: "Retry download of Back Image" }),
  ).toBeNull();
});
