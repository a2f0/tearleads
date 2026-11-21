import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type { BlobAttachmentSummary } from "@tearleads/validators/response";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { attachmentContentSha256 } from "../../../../data/blobs/attachmentContentIdentity";
import {
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
} from "../../../../data/blobs/blobContracts";
import { addDocumentAttachments } from "../../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import type { HydrateDocumentAttachmentBlobsRequest } from "../../../../workflows/blobs/hydration/hydrate";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState, type DocumentStoreState } from "../state";
import { hydrateAttachmentBlobs } from "./attachmentHydration";
import { checkHeldAttachmentCopies } from "./heldCopyCheckRun";

const BYTES = new Uint8Array([1, 2, 3, 4]);
const SLOT_ID = "file";
const STORAGE_KEY = "blob-held";

function createMemoryBlobStore(files: Map<string, BlobBytes>): BlobStore {
  return {
    deleteBytes: async (storageKey) => {
      files.delete(storageKey);
    },
    openByteSource: async (storageKey) => {
      const bytes = files.get(storageKey);
      return bytes ? createBlobByteSource(bytes) : null;
    },
    readBytes: async (storageKey) => files.get(storageKey) ?? null,
    writeByteSource: async () => undefined,
    writeBytes: async (storageKey, bytes) => {
      files.set(storageKey, bytes);
    },
  };
}

/** A synced note holding `file` under STORAGE_KEY, opened through SQLite. */
async function openHeldCopy(
  name: string,
  files: Map<string, BlobBytes>,
  options: { blobId?: string | null; uploading?: boolean } = {},
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
    contentSha256: attachment.contentSha256,
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
    close: () => {
      state.doc?.free();
      fixture.remoteDocument.free();
      sqlite.close();
    },
    runtime,
    state,
  };
}

function slotView(state: DocumentStoreState) {
  return {
    status: state.snapshot.attachmentStatusBySlotId[SLOT_ID],
    storageKey: state.snapshot.attachmentStorageKeyBySlotId[SLOT_ID],
  };
}

test("a held copy whose file is missing is reported unavailable and fetched again", async () => {
  const held = await openHeldCopy("held-copy-missing", new Map());
  try {
    expect(slotView(held.state)).toEqual({
      status: undefined,
      storageKey: STORAGE_KEY,
    });
    const signal = held.state.remoteUpdateSignalSeq;
    await held.check();
    expect(slotView(held.state)).toEqual({
      status: "unavailable",
      storageKey: undefined,
    });
    // A fresh remote signal makes the next pass list the slot's binding.
    expect(held.state.remoteUpdateSignalSeq).toBe(signal + 1);
    expect(held.state.remoteUpdatePending).toBe(true);
  } finally {
    held.close();
  }
});

test("a held copy whose bytes differ from its row is reported unavailable", async () => {
  const files = new Map([[STORAGE_KEY, new Uint8Array([9, 9, 9, 9])]]);
  const held = await openHeldCopy("held-copy-damaged", files);
  try {
    await held.check();
    expect(slotView(held.state)).toEqual({
      status: "unavailable",
      storageKey: undefined,
    });
  } finally {
    held.close();
  }
});

test("an intact copy is checked once and left as it is", async () => {
  const files = new Map([[STORAGE_KEY, BYTES]]);
  const held = await openHeldCopy("held-copy-intact", files);
  const blobStore = held.runtime.infra.blobStore;
  let reads = 0;
  Object.assign(held.runtime.infra, {
    blobStore: {
      ...blobStore,
      openByteSource: (storageKey: string) => {
        reads += 1;
        return blobStore.openByteSource(storageKey);
      },
    },
  });
  try {
    const signal = held.state.remoteUpdateSignalSeq;
    await held.check();
    await held.check();
    expect(reads).toBe(1);
    expect(slotView(held.state)).toEqual({
      status: undefined,
      storageKey: STORAGE_KEY,
    });
    expect(held.state.remoteUpdateSignalSeq).toBe(signal);
  } finally {
    held.close();
  }
});

for (const [label, options] of [
  ["an unbound local copy", { blobId: null }],
  ["a copy its queued upload still reads", { uploading: true }],
] as const) {
  test(`${label} is not checked: the server cannot restore it`, async () => {
    const held = await openHeldCopy(`held-copy-${label}`, new Map(), options);
    try {
      await held.check();
      expect(slotView(held.state).status).not.toBe("unavailable");
    } finally {
      held.close();
    }
  });
}

test("an unavailable copy downloads its binding again and holds the verified bytes", async () => {
  const files = new Map<string, BlobBytes>();
  const held = await openHeldCopy("held-copy-repair", files);
  try {
    await held.check();
    const requests: HydrateDocumentAttachmentBlobsRequest[] = [];
    Object.assign(held.runtime.blobAttachments, {
      hydrateDocumentAttachmentBlobs: async (
        request: HydrateDocumentAttachmentBlobsRequest,
      ) => {
        requests.push(request);
        request.onBindingsChecked?.();
        return [
          {
            attachment: held.attachment,
            binding: { blobId: "held" } as BlobAttachmentSummary,
            bytes: BYTES,
            contentSha256: held.attachment.contentSha256,
            intentMismatch: false,
            storageKey: STORAGE_KEY,
          },
        ];
      },
    });
    const { doc, record } = held.state;
    if (!doc) throw new Error("Expected a loaded document");
    await hydrateAttachmentBlobs(
      held.state,
      doc,
      record,
      createPrincipalPolicyOperation(),
    );
    // The held blob id is withheld so the same binding is fetched again; the
    // storage key stays, so bytes the document does not record are refused.
    expect(requests[0]?.localBlobIdBySlotId?.[SLOT_ID]).toBeUndefined();
    expect(requests[0]?.localStorageKeyBySlotId?.[SLOT_ID]).toBe(STORAGE_KEY);
    expect(files.get(STORAGE_KEY)).toEqual(BYTES);
    expect(slotView(held.state)).toEqual({
      status: undefined,
      storageKey: STORAGE_KEY,
    });
  } finally {
    held.close();
  }
});
