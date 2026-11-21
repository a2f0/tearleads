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
  readBlobByteSource,
} from "../../../../data/blobs/blobContracts";
import { wrapEncryptedBlobStore } from "../../../../data/blobs/encryptedBlobStore";
import { addDocumentAttachments } from "../../../../data/documents/documentContent";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import type { HydrateDocumentAttachmentBlobsRequest } from "../../../../workflows/blobs/hydration/hydrate";
import { createPrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import {
  createDocumentStoreState,
  type DocumentStoreState,
  resetDocumentStore,
} from "../state";
import { hydrateAttachmentBlobs } from "./attachmentHydration";
import { checkHeldAttachmentCopies } from "./heldCopyCheckRun";
import { unavailableHeldCopySlotIds } from "./heldCopyChecks";

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
    writeByteSource: async (storageKey, source) => {
      files.set(storageKey, await readBlobByteSource(source));
    },
    writeBytes: async (storageKey, bytes) => {
      files.set(storageKey, bytes);
    },
  };
}

/** A synced note holding `file` under STORAGE_KEY, opened through SQLite. */
async function openHeldCopy(
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

/** Count the store's opens, delegating to `open` instead when it is given. */
function countOpens(
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

async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !condition(); turn += 1)
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(condition()).toBe(true);
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

for (const [label, damage] of [
  ["truncated", (bytes: BlobBytes) => bytes.slice(0, -1)],
  [
    "altered",
    (bytes: BlobBytes) => {
      const altered = bytes.slice();
      altered[altered.byteLength - 1] = (altered.at(-1) ?? 0) ^ 1;
      return altered;
    },
  ],
] as const) {
  test(`an encrypted copy whose file was ${label} is reported unavailable`, async () => {
    const files = new Map<string, BlobBytes>();
    const held = await openHeldCopy(`held-copy-encrypted-${label}`, files);
    const encrypted = wrapEncryptedBlobStore(held.runtime.infra.blobStore, {
      key: "held-copy-key",
      kdfIterations: 1,
      namespace: "held-copy",
    });
    Object.assign(held.runtime.infra, { blobStore: encrypted });
    try {
      await encrypted.writeBytes(STORAGE_KEY, BYTES);
      const stored = files.get(STORAGE_KEY);
      if (!stored) throw new Error("Expected stored ciphertext");
      // The store refuses the file before any digest: that refusal is damage.
      files.set(STORAGE_KEY, damage(stored));
      await held.check();
      expect(slotView(held.state)).toEqual({
        status: "unavailable",
        storageKey: undefined,
      });
    } finally {
      held.close();
    }
  });
}

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

test("a failed read is not a finding: the copy stays readable and is checked again", async () => {
  const held = await openHeldCopy("held-copy-unreadable", new Map());
  const blobStore = held.runtime.infra.blobStore;
  const opens = countOpens(held.runtime, async (storageKey) => {
    if (opens.count === 1) throw new Error("The database was released.");
    return blobStore.openByteSource(storageKey);
  });
  try {
    const signal = held.state.remoteUpdateSignalSeq;
    await held.check();
    expect(slotView(held.state)).toEqual({
      status: undefined,
      storageKey: STORAGE_KEY,
    });
    expect(held.state.remoteUpdateSignalSeq).toBe(signal);
    await held.check();
    expect(opens.count).toBe(2);
    expect(slotView(held.state).status).toBe("unavailable");
  } finally {
    held.close();
  }
});

test("a read that outlives a store reset and reload still reports its finding", async () => {
  const held = await openHeldCopy("held-copy-reloaded", new Map());
  const blobStore = held.runtime.infra.blobStore;
  const firstOpen = Promise.withResolvers<null>();
  const opens = countOpens(held.runtime, (storageKey) =>
    opens.count === 1
      ? firstOpen.promise
      : blobStore.openByteSource(storageKey),
  );
  try {
    const checking = held.check();
    await until(() => opens.count === 1);
    resetDocumentStore(held.state);
    expect(await held.ensureReady()).toBe(true);
    // The reload finds the same copy already being read and waits for it.
    const signal = held.state.remoteUpdateSignalSeq;
    firstOpen.resolve(null);
    await checking;
    expect(opens.count).toBe(1);
    expect(slotView(held.state)).toEqual({
      status: "unavailable",
      storageKey: undefined,
    });
    expect(held.state.remoteUpdateSignalSeq).toBe(signal + 1);
  } finally {
    held.close();
  }
});

test("a missing copy that already differed from the document is fetched again flagged", async () => {
  const served = new Uint8Array([5, 6, 7, 8]);
  const servedSha256 = await attachmentContentSha256(served);
  const files = new Map<string, BlobBytes>();
  const held = await openHeldCopy("held-copy-differed", files, {
    rowContentSha256: servedSha256,
  });
  try {
    expect(slotView(held.state).status).toBe("intent-mismatch");
    await held.check();
    expect(slotView(held.state).status).toBe("unavailable");
    const requests: HydrateDocumentAttachmentBlobsRequest[] = [];
    Object.assign(held.runtime.blobAttachments, {
      hydrateDocumentAttachmentBlobs: async (
        request: HydrateDocumentAttachmentBlobsRequest,
      ) => {
        requests.push(request);
        return [
          {
            attachment: held.attachment,
            binding: { blobId: "held" } as BlobAttachmentSummary,
            bytes: served,
            contentSha256: servedSha256,
            intentMismatch: true,
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
    // No held copy is left to protect, so the served bytes come back flagged
    // instead of being refused for differing from the document.
    expect(requests[0]?.localStorageKeyBySlotId?.[SLOT_ID]).toBeUndefined();
    expect(files.get(STORAGE_KEY)).toEqual(served);
    expect(slotView(held.state)).toEqual({
      status: "intent-mismatch",
      storageKey: STORAGE_KEY,
    });
  } finally {
    held.close();
  }
});

test("a reload checks the copy a new blob store holds", async () => {
  const held = await openHeldCopy("held-copy-new-store", new Map());
  try {
    await held.check();
    expect(unavailableHeldCopySlotIds(held.state)).toEqual(new Set([SLOT_ID]));
    // A finding about one blob store says nothing about another's file.
    Object.assign(held.runtime.infra, {
      blobStore: createMemoryBlobStore(new Map([[STORAGE_KEY, BYTES]])),
    });
    expect(unavailableHeldCopySlotIds(held.state).size).toBe(0);
    const opens = countOpens(held.runtime);
    resetDocumentStore(held.state);
    expect(await held.ensureReady()).toBe(true);
    // The host asked once; the reload checks without being asked again.
    await until(() => opens.count === 1);
    expect(slotView(held.state)).toEqual({
      status: undefined,
      storageKey: STORAGE_KEY,
    });
  } finally {
    held.close();
  }
});
