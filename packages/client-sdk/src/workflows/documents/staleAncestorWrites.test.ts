import { expect, test } from "bun:test";
import { createPendingUpdateRecord } from "../../../test/helpers/documentResponseFixtures";
import { documentWithStaleAncestors } from "../../../test/helpers/staleAncestorDocument";
import {
  verifiedBlobWrapTargetsFromDocumentProjection,
  wrapBlobContentKey,
} from "../../data/documents/blob/shared/projection";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

test("stale ancestors permit read-only sync but cannot receive new document ciphertext", async () => {
  const { database, input, projection } = await documentWithStaleAncestors();
  try {
    const sync = {
      ...input,
      writerProjection: projection,
      localVersionVector: null,
    };
    const read = await buildMaterializedDocumentSyncPlan(sync);
    expect(read.plan.request.outgoingUpdates).toEqual([]);
    await expect(
      buildMaterializedDocumentSyncPlan({
        ...sync,
        pendingUpdates: [createPendingUpdateRecord()],
      }),
    ).rejects.toThrow("ancestor KEK repair");
  } finally {
    database.close();
  }
});

test("stale ancestors cannot receive newly wrapped blob content keys", async () => {
  const { database, input, projection } = await documentWithStaleAncestors();
  try {
    const targets = verifiedBlobWrapTargetsFromDocumentProjection({
      bindingId: crypto.randomUUID(),
      documentId: projection.documentId,
      writerProjection: projection,
    });
    expect(targets.length).toBeGreaterThan(0);
    await expect(
      wrapBlobContentKey({
        ...input,
        contentKey: crypto.getRandomValues(new Uint8Array(32)),
        secretKey: input.targetSecretKey,
        targets,
        writerProjection: projection,
      }),
    ).rejects.toThrow("ancestor KEK repair");
  } finally {
    database.close();
  }
});

test("a leaf rekey cannot wrap a successor through a stale intermediate", async () => {
  const { database, input, fixture } = await documentWithStaleAncestors();
  try {
    await expect(
      buildMaterializedContainerRekeyPlan({
        ...input,
        previousProjection: fixture.projection,
      }),
    ).rejects.toThrow("ancestor KEK repair");
  } finally {
    database.close();
  }
});
