import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  exportAllUpdates,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  type DocumentSyncResponse,
  isDocumentSyncResponse,
} from "@tearleads/validators/response";
import {
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../../test/helpers/data/documentFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import type {
  IncomingDocumentSyncUpdateValidator,
  SyncRemoteDocumentResult,
} from "../../../data/documents/shared/sync/documentSyncTypes";
import { emptyDocumentSyncImportVerdicts } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import { readPullContinuation } from "../../../data/documents/shared/sync/syncPagination";
import { buildMaterializedDocumentSyncPlan } from "../syncPlan/syncPlanMaterial";
import { syncRemoteDocumentResultFromResponse } from "./syncResponseResult";

const ids = {
  deferred: "550e8400-e29b-41d4-a716-446655440b02",
  judged: "550e8400-e29b-41d4-a716-446655440b01",
};

async function pendingUpdate(text: string, id: string) {
  const document = await createDocument(`deferral:${text}`);
  document.getText("text").update(text);
  document.commit();
  const updateData = exportAllUpdates(document);
  document.free();
  return createPendingUpdateRecord({
    id,
    updateData: bytesToBase64(updateData),
    ...getUpdateVersionVectors(updateData),
  });
}

/**
 * Judges a pull's first page of two updates, `judged` then `deferred`, with
 * `validate`, the way a sync pass does.
 */
async function judgePage(
  validate: IncomingDocumentSyncUpdateValidator,
  run: (outcome: {
    readonly response: DocumentSyncResponse;
    readonly result: Promise<SyncRemoteDocumentResult>;
  }) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("sync-response-deferral");
  try {
    const fixture = await createMaterializedSyncFixture();
    const planInput = {
      author: fixture.author,
      execSql,
      localVersionVector: null,
      resolveProjectionUserKey: fixture.resolveProjectionUserKey,
      targetSecretKey: fixture.secretKey,
      writerProjection: fixture.writerProjection,
    };
    const historical = await buildMaterializedDocumentSyncPlan({
      ...planInput,
      pendingUpdates: [
        await pendingUpdate("judged", ids.judged),
        await pendingUpdate("deferred", ids.deferred),
      ],
    });
    const { updates } = await createSyncResponse(historical.plan);
    const materializedPlan = await buildMaterializedDocumentSyncPlan({
      ...planInput,
      pendingUpdates: [],
    });
    const response = await createSyncResponse(materializedPlan.plan, {
      pullPage: {
        hasMore: true,
        nextCursor: "next-page",
        throughUpdateId: ids.deferred,
      },
      updates,
    });
    await run({
      response,
      result: syncRemoteDocumentResultFromResponse({
        execSql,
        materializedPlan,
        recoveryPendingUpdatesById: new Map(),
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver({
          author: fixture.author,
          signingPublicKey: fixture.signingPublicKey,
        }),
        response,
        targetSecretKey: fixture.secretKey,
        validateIncomingUpdates: validate,
        writerProjection: fixture.writerProjection,
      }),
    });
  } finally {
    close();
  }
}

test("a page whose judge defers updates applies only what it judged and starts its pull again", async () => {
  const fingerprintEpochs: number[][] = [];
  await judgePage(
    ({ contentKeyFingerprintsByEpoch }) => {
      fingerprintEpochs.push([...contentKeyFingerprintsByEpoch.keys()]);
      return {
        ...emptyDocumentSyncImportVerdicts(),
        deferredUpdateIds: [ids.deferred],
      };
    },
    async ({ response, result: pending }) => {
      const result = await pending;
      // The judge sees the fingerprint of each key it judges under.
      expect(fingerprintEpochs).toHaveLength(1);
      expect(result.decryptedUpdates.map((update) => update.id)).toEqual([
        ids.judged,
      ]);
      expect(result.voidedUpdates).toEqual([]);
      expect(result.hasIncompletePull).toBe(true);
      expect(result.hasHeldPull).toBe(false);
      // No continuation: the next pass pulls again and is served the
      // deferred update, instead of skipping to the next page.
      expect(readPullContinuation(result.response)).toBeNull();
      expect(response.pullPage?.nextCursor).toBe("next-page");
      // The response handed on still parses as a pull page: no further page.
      expect(result.response.pullPage?.hasMore).toBe(false);
      expect(isDocumentSyncResponse(response)).toBe(true);
      expect(isDocumentSyncResponse(result.response)).toBe(true);
    },
  );
});

test("a page held at an unsettled update applies what came before it and ends its pull without pulling again at once", async () => {
  await judgePage(
    () => ({
      ...emptyDocumentSyncImportVerdicts(),
      heldUpdateIds: [ids.deferred],
    }),
    async ({ result: pending }) => {
      const result = await pending;
      expect(result.decryptedUpdates.map((update) => update.id)).toEqual([
        ids.judged,
      ]);
      expect(result.hasHeldPull).toBe(true);
      expect(result.hasIncompletePull).toBe(false);
      expect(readPullContinuation(result.response)).toBeNull();
      expect(isDocumentSyncResponse(result.response)).toBe(true);
    },
  );
});

test("a judge that returns no verdicts fails the pass instead of accepting every update", async () => {
  await judgePage(
    (() => undefined) as unknown as IncomingDocumentSyncUpdateValidator,
    async ({ result }) => {
      await expect(result).rejects.toThrow(
        "Document sync update validator returned no import verdicts",
      );
    },
  );
});
