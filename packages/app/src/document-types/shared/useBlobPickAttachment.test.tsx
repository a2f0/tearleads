import { afterEach, expect, test } from "bun:test";
import type { BlobBytes, BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { createBlobByteSource } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { LogProvider } from "../../providers/logging/LogProvider";
import {
  DocumentBlobPickProvider,
  type DocumentBlobPickRequest,
} from "./DocumentBlobPickContext";
import type { DocumentAttachmentUpload } from "./documentAttachmentUtils";
import { useBlobPickAttachment } from "./useBlobPickAttachment";

afterEach(cleanup);

const SLOT_IDS = ["front-image", "back-image"] as const;

function createBlobStore(bytes: BlobBytes | null): BlobStore {
  return {
    deleteBytes: async () => undefined,
    openByteSource: async () => (bytes ? createBlobByteSource(bytes) : null),
    readBytes: async () => bytes,
    writeByteSource: async () => undefined,
    writeBytes: async () => undefined,
  };
}

const SAMPLE_BYTES = new Uint8Array(new ArrayBuffer(3)) as BlobBytes;

const IMAGE_BLOB: BlobInfo = {
  blobId: "blob-1",
  byteLength: 3,
  createdAt: null,
  documentCount: 0,
  key: "blob:blob-1",
  mimeType: "image/png",
  name: "front.png",
  organizationId: null,
  referenceCount: 0,
  references: [],
  storageKey: "storage-1",
  updatedAt: null,
};

function Harness(params: {
  blobCount?: number;
  containerId: string | null;
  onRequest: (request: DocumentBlobPickRequest) => void;
  picked: BlobInfo | null;
  replaceAttachment: (
    slotId: string,
    attachment: DocumentAttachmentUpload,
  ) => void;
}) {
  // The provider hands the consumer a one-shot picked blob for the front slot.
  let consumed = false;
  const value = {
    consumeBlobPick: (localId: string, slotId: string) => {
      if (consumed || localId !== "local-1" || slotId !== "front-image") {
        return null;
      }
      consumed = true;
      return params.picked;
    },
    loadPickableBlobCount: async () => params.blobCount ?? 1,
    requestBlobPick: params.onRequest,
  };

  return (
    <LogProvider>
      <DocumentBlobPickProvider value={value}>
        <SlotButton
          containerId={params.containerId}
          replaceAttachment={params.replaceAttachment}
        />
      </DocumentBlobPickProvider>
    </LogProvider>
  );
}

function SlotButton(params: {
  containerId: string | null;
  replaceAttachment: (
    slotId: string,
    attachment: DocumentAttachmentUpload,
  ) => void;
}) {
  const blobPicker = useBlobPickAttachment({
    blobStore: createBlobStore(SAMPLE_BYTES),
    containerId: params.containerId,
    errorMessage: "failed",
    localId: "local-1",
    replaceAttachment: params.replaceAttachment,
    slotIds: [...SLOT_IDS],
  });

  return (
    <button
      type="button"
      disabled={!blobPicker}
      onClick={() =>
        blobPicker?.onRequestBlobPick({
          label: "Front Image",
          slotId: "front-image",
        })
      }
    >
      Choose Blob
    </button>
  );
}

test("requests a pick with the slot and applies a returned blob to it", async () => {
  const requests: DocumentBlobPickRequest[] = [];
  const attachments: Array<[string, DocumentAttachmentUpload]> = [];
  const view = render(
    <Harness
      containerId="container-1"
      onRequest={(request) => requests.push(request)}
      picked={IMAGE_BLOB}
      replaceAttachment={(slotId, attachment) =>
        attachments.push([slotId, attachment])
      }
    />,
  );

  // The picked blob is consumed on mount and applied to the front slot.
  await waitFor(() => {
    expect(attachments).toHaveLength(1);
  });
  const [appliedSlotId, applied] = attachments[0] ?? [];
  expect(appliedSlotId).toBe("front-image");
  expect(applied?.name).toBe("front.png");
  expect(applied?.mimeType).toBe("image/png");

  // "Choose Blob" forwards the full slot to the host picker once the container's
  // positive blob count has resolved and revealed it.
  const button = view.getByRole("button", { name: "Choose Blob" });
  await waitFor(() => {
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(button);
  expect(requests).toEqual([
    {
      containerId: "container-1",
      localId: "local-1",
      slot: {
        label: "Front Image",
        slotId: "front-image",
      },
    },
  ]);
});

test("hides the picker when the document has no container", () => {
  const view = render(
    <Harness
      containerId={null}
      onRequest={() => undefined}
      picked={null}
      replaceAttachment={() => undefined}
    />,
  );

  expect(
    (view.getByRole("button", { name: "Choose Blob" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("hides the picker when the container has no blobs to pick", async () => {
  const view = render(
    <Harness
      blobCount={0}
      containerId="container-1"
      onRequest={() => undefined}
      picked={null}
      replaceAttachment={() => undefined}
    />,
  );

  const button = view.getByRole("button", {
    name: "Choose Blob",
  }) as HTMLButtonElement;

  // Flush the async count query and its state update so we assert the settled
  // state, not just the initial disabled render: a zero count must leave the
  // button disabled rather than reveal it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(button.disabled).toBe(true);
});
