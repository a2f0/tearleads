import { expect, test } from "bun:test";
import {
  BYTES,
  countOpens,
  createMemoryBlobStore,
  hydrateHeldCopy,
  openHeldCopy,
  SLOT_ID,
  STORAGE_KEY,
  serveHeldBinding,
  slotView,
  until,
} from "../../../../../test/helpers/stores/heldCopyChecks";
import { attachmentContentSha256 } from "../../../../data/blobs/attachmentContentIdentity";
import type { BlobBytes } from "../../../../data/blobs/blobContracts";
import { wrapEncryptedBlobStore } from "../../../../data/blobs/encryptedBlobStore";
import { resetDocumentStore } from "../state";
import { unavailableHeldCopySlotIds } from "./heldCopyChecks";

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
    const requests = serveHeldBinding(held, {
      bytes: BYTES,
      contentSha256: held.attachment.contentSha256,
      intentMismatch: false,
    });
    await hydrateHeldCopy(held);
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
    const requests = serveHeldBinding(held, {
      bytes: served,
      contentSha256: servedSha256,
      intentMismatch: true,
    });
    await hydrateHeldCopy(held);
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
