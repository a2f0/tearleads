import { afterEach, expect, test } from "bun:test";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DocumentAttachmentSlots } from "./DocumentAttachmentSlots";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";

afterEach(cleanup);

const slots: ReadonlyArray<DocumentAttachmentSlot> = [
  {
    description: "Front side",
    label: "Front Image",
    slotId: "front",
  },
  {
    description: "Back side",
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
  canAttach?: boolean;
  onClearAttachment?: (slotId: string) => void;
}) {
  return render(
    <DocumentAttachmentSlots
      attachmentStatusBySlotId={{}}
      attachments={params?.attachments ?? attachments}
      canAttach={params?.canAttach ?? true}
      imageUrlBySlotId={{}}
      onClearAttachment={params?.onClearAttachment ?? (() => undefined)}
      onSelectedAttachment={() => undefined}
      slots={slots}
    />,
  );
}

test("clear image buttons forward the front and back slot ids", () => {
  const clearedSlotIds: string[] = [];
  const view = renderAttachmentSlots({
    onClearAttachment: (slotId) => {
      clearedSlotIds.push(slotId);
    },
  });

  fireEvent.click(view.getByRole("button", { name: "Clear Front Image" }));
  fireEvent.click(view.getByRole("button", { name: "Clear Back Image" }));

  expect(clearedSlotIds).toEqual(["front", "back"]);
});

test("clear image buttons are hidden for empty slots", () => {
  const view = renderAttachmentSlots({ attachments: [] });

  expect(view.queryByRole("button", { name: "Clear Front Image" })).toBeNull();
  expect(view.queryByRole("button", { name: "Clear Back Image" })).toBeNull();
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

test("clear image buttons are disabled when attachments cannot be changed", () => {
  const view = renderAttachmentSlots({ canAttach: false });

  expect(
    (
      view.getByRole("button", {
        name: "Clear Front Image",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      view.getByRole("button", {
        name: "Clear Back Image",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
