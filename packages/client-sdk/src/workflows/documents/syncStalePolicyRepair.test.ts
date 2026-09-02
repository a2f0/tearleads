import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ContainerMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createSyncResponse,
  writerKeyResolver,
} from "../../../test/helpers/documentFixtures";
import { syncRemoteDocumentWithoutImportValidationForTest as syncRemoteDocument } from "../../../test/helpers/documentSync";
import type {
  PrincipalPolicyBundleCacheRequest,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import { ensureDocumentTables } from "../../data/sqlite/documentPersistence";
import { buildMaterializedDocumentSyncPlan } from "./syncPlanMaterial";

function containerRekey(policyGeneration: number): ContainerMutationRequest {
  return {
    body: { eventType: "container.rekey" },
    event: { eventType: "container.rekey" },
    expectedManifestHash: "container-manifest-hash",
    keyEpoch: { id: "container-key-epoch-id" },
    keyring: null,
    manifest: { objectKind: "container" },
    predecessorBridge: null,
    principalPolicies: [{ policyGeneration }],
    wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
  };
}
const POLICY_BUNDLE = {} as PrincipalPolicyBundleResponse;

test("syncRemoteDocument caches stale policies before replanning inline rekeys", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const pendingUpdates = [createPendingUpdateRecord()];
  const submittedRequests: DocumentSyncRequest[] = [];
  const events: string[] = [];
  let policiesCached = false;
  let projectionRequestCount = 0;
  let rekeyBuildCount = 0;
  const { close, execSql } = await createTestExecSql(
    "sync-stale-policy-repair",
  );
  const warmer = Object.assign(async () => undefined, {
    cacheBundles: async (input: PrincipalPolicyBundleCacheRequest) => {
      events.push("cache-policies");
      expect(input).toEqual({
        bundles: [POLICY_BUNDLE],
        organizationId: author.organizationId,
        stillCurrent: undefined,
      });
      policiesCached = true;
    },
  }) satisfies ReferencedPrincipalPolicyWarmer;

  try {
    const synced = await syncRemoteDocument({
      apiClient: {
        evictDocumentWriterProjection: () => {
          events.push("evict-projection");
        },
        getDocumentWriterProjection: async () => {
          projectionRequestCount += 1;
          events.push(`get-projection-${projectionRequestCount}`);
          return writerProjection;
        },
        syncDocument: async () => {
          throw new Error("Expected syncDocumentResult to handle sync");
        },
        syncDocumentResult: async (documentId, request) => {
          submittedRequests.push(request);
          events.push(`submit-${submittedRequests.length}`);
          if (submittedRequests.length === 1) {
            return {
              code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
              message: "Principal policy is stale",
              ok: false,
              report: () => undefined,
              stalePrincipalPolicies: [POLICY_BUNDLE],
              status: 409,
            };
          }

          const materialized = await buildMaterializedDocumentSyncPlan({
            author,
            containerRekeys: request.containerRekeys,
            execSql,
            localVersionVector: null,
            pendingUpdates,
            resolveProjectionUserKey,
            targetSecretKey: secretKey,
            writerProjection,
          });
          return {
            data: await createSyncResponse({
              ...materialized.plan,
              documentId,
              request,
            }),
            ok: true,
          };
        },
      },
      author,
      buildContainerRekeys: async () => {
        rekeyBuildCount += 1;
        events.push(`build-rekey-${rekeyBuildCount}`);
        return [containerRekey(policiesCached ? 2 : 1)];
      },
      documentId: writerProjection.documentId,
      execSql,
      localVersionVector: null,
      pendingUpdates,
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
      targetSecretKey: secretKey,
      warmReferencedPrincipalPolicies: warmer,
    });

    expect(synced?.persistedState.documentId).toBe(writerProjection.documentId);
    expect(submittedRequests).toHaveLength(2);
    expect(
      submittedRequests[0]?.containerRekeys?.[0]?.principalPolicies,
    ).toEqual([{ policyGeneration: 1 }]);
    expect(
      submittedRequests[1]?.containerRekeys?.[0]?.principalPolicies,
    ).toEqual([{ policyGeneration: 2 }]);
    expect(events).toEqual([
      "get-projection-1",
      "build-rekey-1",
      "submit-1",
      "cache-policies",
      "evict-projection",
      "get-projection-2",
      "build-rekey-2",
      "submit-2",
    ]);
  } finally {
    close();
  }
});

test("materialized sync rejects inline rekeys without an outgoing update", async () => {
  const { author, secretKey, writerProjection } =
    await createMaterializedSyncFixture();

  await expect(
    buildMaterializedDocumentSyncPlan({
      author,
      containerRekeys: [containerRekey(1)],
      localVersionVector: null,
      pendingUpdates: [],
      targetSecretKey: secretKey,
      trustedLocalProjection: true,
      writerProjection,
    }),
  ).rejects.toThrow("container rekeys require an outgoing update");
});

test("update-id recovery skips inline rekeys on its read-only attempt", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const pendingUpdates = [createPendingUpdateRecord()];
  const submittedRequests: DocumentSyncRequest[] = [];
  let rekeyBuildCount = 0;
  const { close, execSql } = await createTestExecSql(
    "sync-rekey-update-id-recovery",
  );
  await ensureDocumentTables(execSql);

  try {
    const synced = await syncRemoteDocument({
      apiClient: {
        getDocumentWriterProjection: async () => writerProjection,
        syncDocument: async () => {
          throw new Error("Expected syncDocumentResult to handle sync");
        },
        syncDocumentResult: async (documentId, request) => {
          submittedRequests.push(request);
          if (submittedRequests.length === 1) {
            return {
              code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
              message: "Document update id conflict",
              ok: false,
              report: () => undefined,
              status: 409,
            };
          }

          const materialized = await buildMaterializedDocumentSyncPlan({
            author,
            execSql,
            localVersionVector: null,
            pendingUpdates: [],
            resolveProjectionUserKey,
            targetSecretKey: secretKey,
            writerProjection,
          });
          return {
            data: await createSyncResponse({
              ...materialized.plan,
              documentId,
              request,
            }),
            ok: true,
          };
        },
      },
      author,
      buildContainerRekeys: async () => {
        rekeyBuildCount += 1;
        return [containerRekey(rekeyBuildCount)];
      },
      documentId: writerProjection.documentId,
      execSql,
      localVersionVector: null,
      pendingUpdates,
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
      targetSecretKey: secretKey,
    });

    expect(synced).not.toBeNull();
    expect(rekeyBuildCount).toBe(1);
    expect(
      submittedRequests.map((request) => request.containerRekeys?.length ?? 0),
    ).toEqual([1, 0]);
  } finally {
    close();
  }
});
