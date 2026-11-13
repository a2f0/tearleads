import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  attachmentBindings,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { prefetchBlobKekTargets } from "./blobKekTargets";

test("target prefetch bounds container frontiers and leaves missing targets uncached", async () => {
  const blobId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const manifestHash = `head-${documentId}`;
  const ids = Array.from({ length: 501 }, () => crypto.randomUUID());
  await db
    .insert(attachmentBindings)
    .values({ blobId, documentId, slotId: "many-links" });
  await db.insert(accessManifestHeads).values({
    objectId: documentId,
    objectKind: "document",
    epoch: 1,
    organizationId: crypto.randomUUID(),
    manifestHash,
  });
  await db.insert(accessManifestDocumentLinkProjection).values(
    ids.map((containerId) => ({
      documentId,
      manifestHash,
      containerId,
    })),
  );
  const bindCounts: number[] = [];
  // Compile the very query sent to the real database; do not replace its rows.
  const executor = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "execute")
        return (query: Parameters<typeof db.execute>[0]) => {
          if (typeof query !== "string")
            bindCounts.push(
              new PgDialect().sqlToQuery(query.getSQL()).params.length,
            );
          return target.execute(query);
        };
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const prefetch = await prefetchBlobKekTargets([blobId], executor);
    expect(prefetch.containerTargetById).toBeNull();
    expect(prefetch.linkRowsByManifestHash.get(manifestHash)).toHaveLength(
      ids.length,
    );
    expect(bindCounts.length).toBeGreaterThan(0);
    // 100 roots plus recursive-query constants; a path has at most 100 nodes.
    // This also bounds the later three-bind-per-node retained-history query.
    expect(Math.max(...bindCounts)).toBeLessThanOrEqual(128);
  } finally {
    await db
      .delete(attachmentBindings)
      .where(eq(attachmentBindings.blobId, blobId));
    await db
      .delete(accessManifestHeads)
      .where(eq(accessManifestHeads.objectId, documentId));
    await db
      .delete(accessManifestDocumentLinkProjection)
      .where(eq(accessManifestDocumentLinkProjection.documentId, documentId));
  }
});
