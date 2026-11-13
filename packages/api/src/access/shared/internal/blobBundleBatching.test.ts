import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  attachmentBindings,
  blobContentKeyEpochs,
} from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";
import {
  getLatestBlobContentKeyBundle,
  getLatestBlobContentKeyBundles,
} from "./blobContentKeyStore";
import { prefetchBlobKekTargets } from "./blobKekTargets";

test("latest blob bundles bound each batch and preserve boundary identities", async () => {
  const ids = Array.from({ length: 1001 }, () => crypto.randomUUID());
  await db.insert(blobContentKeyEpochs).values(
    ids.map((blobId, index) => ({
      blobId,
      contentKeyEpoch: 1,
      targetHash: `target-${index}`,
    })),
  );
  try {
    const counter = { statements: 0 };
    const bundles = await withDatabaseStatementCounter(counter, () =>
      getLatestBlobContentKeyBundles([...ids, ...ids.slice(0, 3)], db),
    );
    expect([...bundles.keys()].sort()).toEqual([...ids].sort());
    for (const index of [0, 499, 500, 999, 1000]) {
      const id = ids[index];
      if (!id) throw new Error("Expected boundary blob");
      const single = await getLatestBlobContentKeyBundle(id, db);
      if (!single) throw new Error("Expected stored boundary bundle");
      expect(bundles.get(id)).toEqual(single);
      expect(bundles.get(id)?.targetHash).toBe(`target-${index}`);
    }
    // 500 blobs per epoch query and at most 1,000 target-query binds.
    expect(counter.statements).toBe(6);
  } finally {
    await db
      .delete(blobContentKeyEpochs)
      .where(inArray(blobContentKeyEpochs.blobId, ids));
  }
});

test("target prefetch bounds large blob frontiers without caching absent bindings", async () => {
  const ids = Array.from({ length: 1001 }, () => crypto.randomUUID());
  const counter = { statements: 0 };
  const prefetch = await withDatabaseStatementCounter(counter, () =>
    prefetchBlobKekTargets([...ids, ...ids.slice(0, 3)], db, true),
  );
  expect(prefetch.bindingsByBlobId.size).toBe(0);
  expect(prefetch.documentHeadById.size).toBe(0);
  expect(prefetch.allowHistoricalParentEpochs).toBe(true);
  expect(counter.statements).toBe(3);
});

test("a shared blob bounds document and manifest frontiers without losing heads", async () => {
  const blobId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const ids = Array.from({ length: 1001 }, () => crypto.randomUUID());
  await db.insert(attachmentBindings).values(
    ids.map((documentId) => ({
      blobId,
      documentId,
      slotId: "shared",
    })),
  );
  await db.insert(accessManifestHeads).values(
    ids.map((objectId) => ({
      objectId,
      objectKind: "document" as const,
      organizationId,
      epoch: 1,
      manifestHash: `head-${objectId}`,
    })),
  );
  try {
    const counter = { statements: 0 };
    const prefetch = await withDatabaseStatementCounter(counter, () =>
      prefetchBlobKekTargets([blobId], db, true),
    );
    expect(prefetch.bindingsByBlobId.get(blobId)).toHaveLength(ids.length);
    expect([...prefetch.documentHeadById.keys()].sort()).toEqual(
      [...ids].sort(),
    );
    for (const id of [ids[0], ids[500], ids[1000]]) {
      if (!id) throw new Error("Expected boundary document");
      expect(prefetch.documentHeadById.get(id)?.manifestHash).toBe(
        `head-${id}`,
      );
    }
    expect(prefetch.linkRowsByManifestHash.size).toBe(0);
    expect(counter.statements).toBe(7);
  } finally {
    await db
      .delete(attachmentBindings)
      .where(inArray(attachmentBindings.documentId, ids));
    await db
      .delete(accessManifestHeads)
      .where(inArray(accessManifestHeads.objectId, ids));
  }
});
