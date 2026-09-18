import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createPendingUpdateRecord,
  createResponseFromRequest,
} from "../../../test/helpers/documentResponseFixtures";
import {
  verifiedBlobWrapTargetsFromDocumentProjection,
  wrapBlobContentKey,
} from "../../data/documents/blob/shared/projection";
import { createRotatedAncestorFixture } from "../containers/child/ancestorRotationRecovery.testFixtures";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "./create";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

async function documentWithStaleAncestors() {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("stale-ancestor-document");
  try {
    const input = { ...fixture.input, execSql: database.execSql };
    const created = await buildMaterializedDocumentCreatePlan({
      ...input,
      containerProjection: fixture.grandchild.projection,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.grandchild.projection,
      response: await createResponseFromRequest(created.plan.request),
    });
    return {
      fixture,
      input,
      database,
      projection: {
        ...original,
        authorizingContainerPaths: [fixture.projection],
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

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
