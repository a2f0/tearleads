import { afterEach, expect, spyOn, test } from "bun:test";
import { type BlobInfo, createMemoryBlobStore } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { LogProvider } from "../../providers/logging/LogProvider";
import * as Runtime from "../../providers/sdk/TearleadsProvider";
import * as Documents from "../../stores/documents/DocumentsProvider";
import {
  DocumentBlobPickProvider,
  type DocumentBlobPickRequest,
} from "./DocumentBlobPickContext";
import type { DocumentAttachmentUpload } from "./documentAttachmentUtils";
import {
  EQUIPMENT_ATTACHMENT_SLOTS,
  readEquipmentFields,
} from "./equipmentDocumentDefinition";
import { useAttachedStructuredDocument } from "./useAttachedStructuredDocument";

afterEach(cleanup);

test("choosing a blob appends a photo without replacing an existing one", async () => {
  const blobStore = createMemoryBlobStore();
  const bytes = new Uint8Array([1, 2, 3]);
  await blobStore.writeBytes("picked", bytes);
  const blob: BlobInfo = {
    blobId: "picked",
    byteLength: bytes.length,
    createdAt: null,
    documentCount: 0,
    key: "picked",
    mimeType: "image/jpeg",
    name: "picked.jpg",
    organizationId: null,
    referenceCount: 0,
    references: [],
    storageKey: "picked",
    updatedAt: null,
  };
  const writes: Array<{ slotId: string; upload: DocumentAttachmentUpload }> =
    [];
  const documentValue = {
    attachments: [
      {
        slotId: "equipment-photos:existing",
        name: "existing.jpg",
        contentSha256: "existing",
        byteLength: 3,
        mimeType: "image/jpeg",
      },
    ],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: true,
    canWrite: true,
    ready: true,
    structuredFields: {},
    replaceAttachment: async (
      slotId: string,
      upload: DocumentAttachmentUpload,
    ) => {
      writes.push({ slotId, upload });
    },
    removeAttachment: async () => undefined,
    setStructuredFields: async () => undefined,
  } as unknown as ReturnType<typeof Documents.useDocument>;
  const documentSpy = spyOn(Documents, "useDocument").mockReturnValue(
    documentValue,
  );
  const spies = [
    spyOn(Runtime, "useTearleadsRuntime").mockReturnValue({
      infra: { blobStore },
    } as Runtime.RuntimeSnapshot),
    documentSpy,
  ];
  const requests: DocumentBlobPickRequest[] = [];
  let picked: BlobInfo | null = null;
  const pickProvider = {
    consumeBlobPick: (localId: string, slotId: string) => {
      if (localId !== "tool" || slotId !== requests.at(-1)?.slot.slotId)
        return null;
      const result = picked;
      picked = null;
      return result;
    },
    loadPickableBlobCount: async () => 1,
    requestBlobPick: (value: DocumentBlobPickRequest) => {
      requests.push(value);
    },
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <LogProvider>
      <DocumentBlobPickProvider value={pickProvider}>
        {children}
      </DocumentBlobPickProvider>
    </LogProvider>
  );
  const mount = () =>
    renderHook(
      () =>
        useAttachedStructuredDocument({
          containerId: "container",
          documentLabel: "tool",
          initialEditing: true,
          localId: "tool",
          readFields: readEquipmentFields,
          slots: EQUIPMENT_ATTACHMENT_SLOTS,
        }),
      { wrapper },
    );
  try {
    const first = mount();
    await waitFor(() =>
      expect(first.result.current.slotsProps.blobPicker).toBeDefined(),
    );
    const slotId = "equipment-photos";
    act(() =>
      first.result.current.slotsProps.blobPicker?.onRequestBlobPick({
        label: "Equipment Photos",
        slotId,
        multiple: true,
      }),
    );
    expect(requests[0]).toEqual({
      containerId: "container",
      localId: "tool",
      slot: { label: "Equipment Photos", slotId, multiple: true },
    });
    first.unmount();
    picked = blob;
    documentSpy.mockReturnValue({
      ...documentValue,
      ready: false,
      attachments: [],
    });
    const second = mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(writes).toHaveLength(0);
    documentSpy.mockReturnValue(documentValue);
    second.rerender();
    await waitFor(() => expect(writes).toHaveLength(1));
    const write = writes[0];
    expect(write?.slotId).toStartWith(`${slotId}:`);
    expect(write?.slotId).not.toBe("equipment-photos:existing");
    expect(write?.upload.name).toBe("picked.jpg");
    expect(write?.upload.mimeType).toBe("image/jpeg");
    second.unmount();
  } finally {
    cleanup();
    for (const spy of spies) spy.mockRestore();
  }
});
