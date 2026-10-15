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
      authorizationTargets: bundle(contentKeyEpoch).targets.map((target) => ({
        containerId: target.containerId,
        containerKeyEpoch: target.containerKeyEpoch,
        containerKeyEpochId: target.containerKeyEpochId,
        containerManifestHash: target.containerManifestHash,
      })),
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

function fixture(
  entries: readonly ReturnType<typeof entry>[],
  currentEpoch = 2,
) {
  const currentBundle = bundle(currentEpoch);
  const bundlesByEpoch = new Map(
    Array.from({ length: currentEpoch }, (_, index) => [
      index + 1,
      bundle(index + 1),
    ]),
  );
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
    cursorHmacKey: "tearleads-test-document-sync-cursor-hmac-key",
    entries,
    identity: {
      contentKeyEpoch: currentEpoch,
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
    [1],
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
    ...fixture([first], 5),
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
    ...fixture([first, entry(2, 3), entry(3, 4)], 5),
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

test("the current epoch's bundle travels only as contentKeyBundle", async () => {
  const loadedEpochs: number[] = [];
  const entries = [entry(1, 1), entry(2, 3), entry(3, 3), entry(4, 1)];
  const base = fixture(entries, 3);
  const response = await buildPaginatedSyncPullResponse({
    ...base,
    loadContentKeyBundle: async (contentKeyEpoch) => {
      loadedEpochs.push(contentKeyEpoch);
      return base.loadContentKeyBundle(contentKeyEpoch);
    },
  });

  expect(response.updates).toHaveLength(entries.length);
  expect(response.contentKeyBundle.contentKeyEpoch).toBe(3);
  expect(response.contentKeyBundles).toEqual([
    toContentKeyBundleResponse(bundle(1)),
  ]);
  expect(loadedEpochs).toEqual([1]);
});

test("pages at the current epoch and empty probes carry no bundle array", async () => {
  for (const entries of [[], [entry(1, 2)], [entry(1, 2), entry(2, 2)]]) {
    const response = await buildPaginatedSyncPullResponse({
      ...fixture(entries),
      loadContentKeyBundle: async () => {
        throw new Error("The current epoch's bundle must not be reloaded");
      },
    });
    expect(response.updates).toHaveLength(entries.length);
    expect(response.contentKeyBundles).toEqual([]);
  }
});

test("byte accounting counts the current bundle once", async () => {
  const first = entry(1, 2);
  const entries = [first, entry(2, 2)];
  const unbounded = await buildPaginatedSyncPullResponse(fixture(entries));
  const exactBytes = sizedResponseBytes(unbounded);

  const exact = await buildPaginatedSyncPullResponse({
    ...fixture(entries),
    maxBytes: exactBytes,
  });
  expect(exact.updates).toHaveLength(entries.length);
  expect(exact.pullPage).toEqual(unbounded.pullPage);
  expect(sizedResponseBytes(exact)).toBe(exactBytes);

  const trimmed = await buildPaginatedSyncPullResponse({
    ...fixture(entries),
    maxBytes: exactBytes - 1,
  });
  expect(trimmed.updates).toEqual([first.update]);
  expect(sizedResponseBytes(trimmed)).toBeLessThanOrEqual(exactBytes - 1);
});
