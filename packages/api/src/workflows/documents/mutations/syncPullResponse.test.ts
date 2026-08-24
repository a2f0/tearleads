import { expect, test } from "bun:test";
import type { StoredDocumentContentKeyBundle } from "../../../access/read/documentContentKeyStore";
import { toContentKeyBundleResponse } from "./shared/records";
import { buildPaginatedSyncPullResponse } from "./syncPullResponse";

const DOCUMENT_ID = "document-1";

function bundle(contentKeyEpoch: number): StoredDocumentContentKeyBundle {
  return {
    contentKeyEpoch,
    documentId: DOCUMENT_ID,
    linkSetManifestHash: `manifest-${contentKeyEpoch}`,
    targetHash: `targets-${contentKeyEpoch}`,
    targets: [
      {
        containerId: "container-1",
        containerKeyEpoch: 1,
        containerKeyEpochId: "container-key-1",
        containerManifestHash: "container-manifest-1",
        wrappedKey: `wrapped-${contentKeyEpoch}`,
        wrappingMetadata: { version: 1 },
      },
    ],
  };
}

function entry(sequence: number, contentKeyEpoch: number) {
  return {
    sequence,
    update: {
      accessEpoch: 1,
      authorFingerprint: "fingerprint",
      createdAt: "2026-08-23T00:00:00.000Z",
      documentId: DOCUMENT_ID,
      encryptedData: `encrypted-${sequence}`,
      id: `update-${sequence}`,
      partialEndVersionVector: `end-${sequence}`,
      partialStartVersionVector: `start-${sequence}`,
      plaintextHash: `plaintext-${sequence}`,
      writeHeader: { version: 1 },
    },
    writeHeader: { contentKeyEpoch },
  };
}

function fixture(entries: readonly ReturnType<typeof entry>[]) {
  const currentBundle = bundle(2);
  const bundlesByEpoch = new Map([
    [1, bundle(1)],
    [2, currentBundle],
  ]);
  return {
    base: {
      acceptedOutgoingUpdateIds: [],
      contentKeyBundle: toContentKeyBundleResponse(currentBundle),
      documentId: DOCUMENT_ID,
      documentKekTargets: {
        documentId: DOCUMENT_ID,
        documentKeyTargetHash: currentBundle.targetHash,
        linkedContainerKeyEpochIds: ["container-key-1"],
        linkedContainerManifestHashes: ["container-manifest-1"],
        linkSetManifestHash: currentBundle.linkSetManifestHash,
        targets: [{}],
      },
    },
    currentBundle,
    cursorHmacKey: "symcrypt-test-document-sync-cursor-hmac-key",
    entries,
    identity: {
      contentKeyEpoch: 2,
      documentId: DOCUMENT_ID,
      linkSetManifestHash: currentBundle.linkSetManifestHash,
      targetHash: currentBundle.targetHash,
    },
    loadContentKeyBundle: async (contentKeyEpoch: number) =>
      bundlesByEpoch.get(contentKeyEpoch) ?? null,
    page: {
      hasMore: false,
      lastSequence: entries.at(-1)?.sequence ?? 0,
      lastUpdateId: entries.at(-1)?.update.id ?? null,
    },
    plan: {
      afterSequence: 0,
      upperBoundSequence: 2,
      upperBoundUpdateId: "update-2",
    },
  };
}

function sizedResponseBytes(response: unknown): number {
  return new TextEncoder().encode(
    JSON.stringify({
      ...(response as object),
      commitLsn: "FFFFFFFF/FFFFFFFF",
      commitLsnMode: "untracked",
    }),
  ).byteLength;
}

test("actual envelope bytes trim a multi-epoch page before commit", async () => {
  const first = entry(1, 1);
  const second = entry(2, 2);
  const firstPage = await buildPaginatedSyncPullResponse({
    ...fixture([first]),
    page: { hasMore: true, lastSequence: 1, lastUpdateId: "update-1" },
  });
  const exactFirstPageBytes = sizedResponseBytes(firstPage);

  const trimmed = await buildPaginatedSyncPullResponse({
    ...fixture([first, second]),
    maxBytes: exactFirstPageBytes,
  });
  expect(trimmed.updates).toEqual([first.update]);
  expect(trimmed.contentKeyBundles.map((item) => item.contentKeyEpoch)).toEqual(
    [1, 2],
  );
  expect(trimmed.pullPage).toMatchObject({ hasMore: true });
  expect(trimmed.pullPage?.nextCursor).not.toBeNull();
  expect(sizedResponseBytes(trimmed)).toBeLessThanOrEqual(exactFirstPageBytes);
});

test("an individually oversized update is rejected before commit", async () => {
  const oversized = entry(1, 1);
  await expect(
    buildPaginatedSyncPullResponse({
      ...fixture([oversized]),
      maxBytes: 1,
    }),
  ).rejects.toThrow(
    "Document update and key bundle exceed the pull page byte ceiling",
  );
});

test("content-key bundles load only through the first response overflow", async () => {
  const first = entry(1, 1);
  const exactFirstPage = await buildPaginatedSyncPullResponse({
    ...fixture([first]),
    page: { hasMore: true, lastSequence: 1, lastUpdateId: "update-1" },
  });
  const loadedEpochs: number[] = [];
  const ordinaryBundle = bundle(3);
  const ordinaryTarget = ordinaryBundle.targets[0];
  if (!ordinaryTarget) throw new Error("Expected a bundle target");
  const oversizedBundle: StoredDocumentContentKeyBundle = {
    ...ordinaryBundle,
    targets: [
      {
        ...ordinaryTarget,
        wrappedKey: "x".repeat(sizedResponseBytes(exactFirstPage)),
      },
    ],
  };
  const bundlesByEpoch = new Map([
    [1, bundle(1)],
    [3, oversizedBundle],
    [4, bundle(4)],
  ]);

  const response = await buildPaginatedSyncPullResponse({
    ...fixture([first, entry(2, 3), entry(3, 4)]),
    loadContentKeyBundle: async (contentKeyEpoch) => {
      loadedEpochs.push(contentKeyEpoch);
      return bundlesByEpoch.get(contentKeyEpoch) ?? null;
    },
    maxBytes: sizedResponseBytes(exactFirstPage),
    page: { hasMore: false, lastSequence: 3, lastUpdateId: "update-3" },
    plan: {
      afterSequence: 0,
      upperBoundSequence: 3,
      upperBoundUpdateId: "update-3",
    },
  });

  expect(response.updates).toEqual([first.update]);
  expect(loadedEpochs).toEqual([1, 3]);
});
