import { expect, test } from "bun:test";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createDocument,
  exportAllUpdates,
  getUpdateVersionVectors,
} from "@symcrypt/loro";
import { createTestExecSql } from "@symcrypt/test-utils";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { DocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";

async function pendingUpdate(text: string, id: string) {
  const document = await createDocument(`response-isolation:${text}`);
  document.getText("text").update(text);
  document.commit();
  const updateData = exportAllUpdates(document);
  return createPendingUpdateRecord({
    id,
    updateData: bytesToBase64(updateData),
    ...getUpdateVersionVectors(updateData),
  });
}

test("isolated validation runs before conflict recovery mutates queued rows", async () => {
  const { close, execSql } = await createTestExecSql("sync-response-isolation");
  try {
    const {
      author,
      resolveProjectionUserKey,
      secretKey,
      signingPublicKey,
      writerProjection,
    } = await createMaterializedSyncFixture();
    const updateId = "550e8400-e29b-41d4-a716-4466554400aa";
    const localUpdate = await pendingUpdate("local", updateId);
    const remoteUpdate = await pendingUpdate("remote", updateId);
    const historicalPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [remoteUpdate],
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
    });
    const historicalResponse = await createSyncResponse(historicalPlan.plan);
    const responseUpdate = historicalResponse.updates[0];
    if (!responseUpdate) throw new Error("Expected a response update");
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      author,
      execSql,
      localVersionVector: null,
      pendingUpdates: [],
      resolveProjectionUserKey,
      targetSecretKey: secretKey,
      writerProjection,
    });
    const response = await createSyncResponse(materializedPlan.plan, {
      updates: [responseUpdate],
    });
    const isolated = new DocumentSyncUpdateIsolationError({
      cause: new Error("invalid Loro payload"),
      responseUpdate,
      stage: "loro_import",
      updateId,
    });
    let rekeyCount = 0;
    const commonInput = {
      execSql,
      materializedPlan,
      recoveryPendingUpdatesById: new Map([[updateId, localUpdate]]),
      rekeyPendingUpdate: async () => {
        rekeyCount += 1;
        return crypto.randomUUID();
      },
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({
        author,
        signingPublicKey,
      }),
      response,
      targetSecretKey: secretKey,
      writerProjection,
    };

    await expect(
      syncRemoteDocumentResultFromResponse({
        ...commonInput,
        validateIncomingUpdates: () => {
          throw isolated;
        },
      }),
    ).rejects.toBe(isolated);
    expect(rekeyCount).toBe(0);

    await syncRemoteDocumentResultFromResponse(commonInput);
    expect(rekeyCount).toBe(1);
  } finally {
    close();
  }
});
