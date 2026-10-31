import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestPrincipalHeadProjection,
  type accessManifests,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { insertAccessManifestPrincipalProjection } from "./accessManifestProjections";

function manifestRow(
  objectKind: "container" | "document",
): typeof accessManifests.$inferSelect {
  return {
    createdAt: new Date(),
    epoch: 1,
    eventHash: `event-${crypto.randomUUID()}`,
    grantRoot: "grant-root",
    id: crypto.randomUUID(),
    keyTargetHash: "key-target-hash",
    manifestHash: `manifest-${crypto.randomUUID()}`,
    objectId: crypto.randomUUID(),
    objectKind,
    organizationId: crypto.randomUUID(),
    previousManifestHash: null,
    referencedPrincipalHeads: [
      {
        keyEpoch: 1,
        keyFingerprint: "key-fingerprint",
        principalId: crypto.randomUUID(),
        principalType: "group",
        stateHash: "state-hash",
        version: 1,
      },
    ],
    state: {},
    structuralHash: "structural-hash",
    verificationMac: null,
    version: 1,
  };
}

async function projectedRows(manifestHash: string) {
  return db
    .select()
    .from(accessManifestPrincipalHeadProjection)
    .where(
      eq(accessManifestPrincipalHeadProjection.manifestHash, manifestHash),
    );
}

// Document purge deletes no principal-head projection rows, which is sound only
// while no such row can name a document.
test("a document manifest's principal heads are refused, not projected", async () => {
  const document = manifestRow("document");
  await expect(
    insertAccessManifestPrincipalProjection(document, db),
  ).rejects.toThrow(
    "Document access manifests cannot reference principal heads",
  );
  expect(await projectedRows(document.manifestHash)).toEqual([]);

  const container = manifestRow("container");
  await insertAccessManifestPrincipalProjection(container, db);
  expect(await projectedRows(container.manifestHash)).toHaveLength(1);
});
