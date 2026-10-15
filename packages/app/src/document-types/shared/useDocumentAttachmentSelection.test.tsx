import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { LogProvider } from "../../providers/logging/LogProvider";
import {
  type DocumentAttachmentUpload,
  expandAttachmentSlots,
} from "./documentAttachmentUtils";
import { EQUIPMENT_ATTACHMENT_SLOTS } from "./equipmentDocumentDefinition";
import { useDocumentAttachmentSelection } from "./useDocumentAttachmentSelection";

afterEach(cleanup);

const wrapper = ({ children }: PropsWithChildren) => (
  <LogProvider>{children}</LogProvider>
);
const photos = [
  new File(["first"], "first.jpg", { type: "image/jpeg" }),
  new File(["second"], "second.jpg", { type: "image/jpeg" }),
] as unknown as FileList;

test("multi-file selection appends independent images and replacing one keeps its slot", async () => {
  const writes: Array<{ slotId: string; upload: DocumentAttachmentUpload }> =
    [];
  const { result } = renderHook(
    () =>
      useDocumentAttachmentSelection({
        errorMessage: "photo failed",
        slots: EQUIPMENT_ATTACHMENT_SLOTS,
        replaceAttachment: async (slotId, upload) => {
          writes.push({ slotId, upload });
        },
      }),
    { wrapper },
  );
  await act(() => result.current("equipment-photos", photos));
  expect(writes.map((write) => write.upload.name)).toEqual([
    "first.jpg",
    "second.jpg",
  ]);
  expect(new Set(writes.map((write) => write.slotId)).size).toBe(2);
  for (const write of writes)
    expect(write.slotId).toStartWith("equipment-photos:");
  const firstSlot = writes[0]?.slotId ?? "missing";
  await act(() => result.current(firstSlot, photos));
  expect(writes).toHaveLength(3);
  expect(writes[2]?.slotId).toBe(firstSlot);
});

test("single-image receipts still replace and consume just one selected file", async () => {
  const slots: string[] = [];
  const { result } = renderHook(
    () =>
      useDocumentAttachmentSelection({
        errorMessage: "receipt failed",
        slots: EQUIPMENT_ATTACHMENT_SLOTS,
        replaceAttachment: async (slotId) => {
          slots.push(slotId);
        },
      }),
    { wrapper },
  );
  await act(() => result.current("receipt-image", photos));
  expect(slots).toEqual(["receipt-image"]);
});

test("an existing single-slot photo can be replaced while additional photos append", async () => {
  const writes: string[] = [];
  const slots = expandAttachmentSlots(
    EQUIPMENT_ATTACHMENT_SLOTS,
    [
      {
        slotId: "equipment-photos",
        name: "original.jpg",
        contentSha256: "old-photo",
        byteLength: 3,
        mimeType: "image/jpeg",
      },
    ],
    true,
  );
  expect(slots.map((slot) => slot.slotId)).toEqual([
    "equipment-photos",
    "equipment-photos:add",
    "receipt-image",
  ]);
  const { result } = renderHook(
    () =>
      useDocumentAttachmentSelection({
        errorMessage: "photo failed",
        slots,
        replaceAttachment: async (slotId) => {
          writes.push(slotId);
        },
      }),
    { wrapper },
  );
  await act(() => result.current("equipment-photos", photos));
  expect(writes).toEqual(["equipment-photos"]);
  await act(() => result.current("equipment-photos:add", photos));
  expect(writes).toHaveLength(3);
  expect(new Set(writes).size).toBe(3);
  expect(writes[1]).toStartWith("equipment-photos:add:");
});
