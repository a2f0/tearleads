import { expect } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import { attachmentContentSha256 } from "../../../src/data/blobs/attachmentContentIdentity";
import {
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "../../../src/data/blobs/blobContracts";
import { addDocumentAttachments } from "../../../src/data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../src/data/persistence/documents/documentsPersistence";
import { hydrateAttachmentBlobs } from "../../../src/stores/documents/documentStore/attachments/attachmentHydration";
import { checkHeldAttachmentCopies } from "../../../src/stores/documents/documentStore/attachments/heldCopyCheckRun";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../../../src/stores/documents/documentStore/documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../../../src/stores/documents/documentStore/initialization";
import {
  createDocumentStoreState,
  type DocumentStoreState,
} from "../../../src/stores/documents/documentStore/state";
import type { HydrateDocumentAttachmentBlobsRequest } from "../../../src/workflows/blobs/hydration/hydrate";
import { createPrincipalPolicyOperation } from "../../../src/workflows/principals/principalPolicyService";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../workflows/rotationRecoveryRuntime";

export const BYTES = new Uint8Array([1, 2, 3, 4]);
export const SLOT_ID = "file";
export const STORAGE_KEY = "blob-held";

export function createMemoryBlobStore(
  files: Map<string, BlobBytes>,
): BlobStore {
  return {
    deleteBytes: async (storageKey) => {
      files.delete(storageKey);
    },
    openByteSource: async (storageKey) => {
      const bytes = files.get(storageKey);
      return bytes ? createBlobByteSource(bytes) : null;
    },
    readBytes: async (storageKey) => files.get(storageKey) ?? null,
    writeByteSource: async (storageKey, source) => {
      files.set(storageKey, await readBlobByteSource(source));
    },
    writeBytes: async (storageKey, bytes) => {
      files.set(storageKey, bytes);
    },
  };
}

/** A synced note holding `file` under STORAGE_KEY, opened through SQLite. */
export async function openHeldCopy(
  name: string,
  files: Map<string, BlobBytes>,
  options: {
    blobId?: string | null;
    rowContentSha256?: string;
    uploading?: boolean;
  } = {},
) {
  const sqlite = await createTestExecSql(name);
  const fixture = await createRemoteHistoryFixture();
  const { execSql } = sqlite;
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const runtime = createRotationRecoveryRuntime({ execSql, fixture });
  Object.assign(runtime.infra, { blobStore: createMemoryBlobStore(files) });
  const documentId = fixture.writerProjection.documentId;
  const attachment = {
    byteLength: BYTES.byteLength,
    contentSha256: await attachmentContentSha256(BYTES),
    mimeType: "image/png",
    name: "file.png",
    slotId: SLOT_ID,
  };
  addDocumentAttachments(fixture.remoteDocument, [attachment]);
  await persistFullHistoryDocument({
    doc: fixture.remoteDocument,
    documentId,
    execSql,
    localId: "local",
  });
  await sqlDocumentsPersistence.saveLocalAttachment(execSql, {
    blobId: options.blobId === undefined ? "held" : options.blobId,
    byteLength: attachment.byteLength,
    contentSha256: options.rowContentSha256 ?? attachment.contentSha256,
    detachedAt: null,
    localId: "local",
    mimeType: attachment.mimeType,
    slotId: attachment.slotId,
    storageKey: STORAGE_KEY,
  });
  if (options.uploading)
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      ...attachment,
      localId: "local",
      storageKey: STORAGE_KEY,
    });
  const state = createDocumentStoreState(
    "local",
    runtime,
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    documentId,
  );
  const ensureReady = () => ensureDocumentStoreReady(state, () => undefined);
  expect(await ensureReady()).toBe(true);
  return {
    attachment,
    check: () => checkHeldAttachmentCopies(state, ensureReady),
    ensureReady,
    close: () => {
      state.doc?.free();
      fixture.remoteDocument.free();
      sqlite.close();
    },
    runtime,
    state,
  };
}

type HeldCopyFixture = Awaited<ReturnType<typeof openHeldCopy>>;

/**
 * Serve the slot's binding `held` with `bytes`, recording each request; the
 * listing reports its bindings checked, as a completed listing does.
 */
export function serveHeldBinding(
  held: HeldCopyFixture,
  served: { bytes: BlobBytes; contentSha256: string; intentMismatch: boolean },
): HydrateDocumentAttachmentBlobsRequest[] {
  const requests: HydrateDocumentAttachmentBlobsRequest[] = [];
  Object.assign(held.runtime.blobAttachments, {
    hydrateDocumentAttachmentBlobs: async (
      request: HydrateDocumentAttachmentBlobsRequest,
    ) => {
      requests.push(request);
      request.onBindingsChecked?.();
      return [
        {
          ...served,
          attachment: held.attachment,
          binding: { blobId: "held" } as BlobAttachmentSummary,
          storageKey: STORAGE_KEY,
        },
      ];
    },
  });
  return requests;
}

/** One hydration pass over the store's current document. */
export async function hydrateHeldCopy(held: HeldCopyFixture): Promise<void> {
  const { doc, record } = held.state;
  if (!doc) throw new Error("Expected a loaded document");
  await hydrateAttachmentBlobs(
    held.state,
    doc,
    record,
    createPrincipalPolicyOperation(),
  );
}

/** Count the store's opens, delegating to `open` instead when it is given. */
export function countOpens(
  runtime: { infra: { blobStore: BlobStore } },
  open?: (storageKey: string) => ReturnType<BlobStore["openByteSource"]>,
) {
  const blobStore = runtime.infra.blobStore;
  const opens = { count: 0 };
  Object.assign(runtime.infra, {
    blobStore: {
      ...blobStore,
      openByteSource: (storageKey: string) => {
        opens.count += 1;
        return open ? open(storageKey) : blobStore.openByteSource(storageKey);
      },
    },
  });
  return opens;
}

export async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !condition(); turn += 1)
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(condition()).toBe(true);
}

export function slotView(state: DocumentStoreState) {
  return {
    status: state.snapshot.attachmentStatusBySlotId[SLOT_ID],
    storageKey: state.snapshot.attachmentStorageKeyBySlotId[SLOT_ID],
  };
}
