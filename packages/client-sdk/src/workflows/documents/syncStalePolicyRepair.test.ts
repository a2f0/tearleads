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
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import type { DocumentSyncPlan } from "../../data/documents/shared/types";
import type {
  PrincipalPolicyBundleCacheRequest,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import { ensureDocumentTables } from "../../data/sqlite/documentPersistence";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
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

test("syncRemoteDocument retries failed chained rekeys after caching stale policies", async () => {
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
  const rekeyManifestHashes: string[] = [];
  let rekeyTarget:
    | {
        containerId: string;
        containerKeyEpoch: number;
        containerKeyEpochId: string;
        containerManifestHash: string;
      }
    | undefined;
  const { close, execSql } = await createTestExecSql(
    `sync-stale-policy-repair-${crypto.randomUUID()}`,
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
        clearWriterProjectionCaches: () => {
          events.push("clear-projections");
        },
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

          const contentKeyBundle = request.contentKeyBundle;
          if (!contentKeyBundle) {
            throw new Error(
              "Expected inline rekey sync to rotate its content key",
            );
          }
          if (!rekeyTarget) {
            throw new Error("Expected a projected inline rekey target");
          }
          const plan: DocumentSyncPlan = {
            contentKeyEpoch: request.contentKeyEpoch,
            documentId,
            documentKekTargets: {
              ...writerProjection.documentKekTargets,
              documentKeyTargetHash: request.expectedTargetHash,
              linkedContainerKeyEpochIds: [rekeyTarget.containerKeyEpochId],
              linkedContainerManifestHashes: [
                rekeyTarget.containerManifestHash,
              ],
              targets: [{ ...rekeyTarget }],
            },
            documentManifest: writerProjection.documentManifest,
            expectedLinkSetManifestHash: request.expectedLinkSetManifestHash,
            expectedTargetHash: request.expectedTargetHash,
            organizationId: author.organizationId,
            request,
            sourceContentKeyBundle: { documentId, ...contentKeyBundle },
          };
          return {
            data: await createSyncResponse(plan),
            ok: true,
          };
        },
      },
      author,
      buildContainerRekeys: async (currentProjection, verification) => {
        rekeyBuildCount += 1;
        events.push(`build-rekey-${rekeyBuildCount}`);
        expect(policiesCached).toBe(rekeyBuildCount > 1);
        expect(verification.persistVerificationCheckpoints).toBe(false);
        const previousProjection =
          currentProjection.authorizingContainerPaths[0];
        if (!previousProjection) {
          throw new Error("Expected an authorizing container projection");
        }
        const firstRekey = await buildMaterializedContainerRekeyPlan({
          author,
          execSql,
          ...verification,
          previousProjection,
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
        });
        const rekey = await buildMaterializedContainerRekeyPlan({
          author,
          execSql,
          ...verification,
          previousProjection: firstRekey.writerProjection,
          resolveProjectionUserKey,
          targetSecretKey: secretKey,
        });
        rekeyManifestHashes.push(
          firstRekey.plan.manifestHash,
          rekey.plan.manifestHash,
        );
        const nextKek = rekey.writerProjection.containerKeks.at(-1);
        if (!nextKek) {
          throw new Error("Expected a rekeyed container KEK");
        }
        rekeyTarget = {
          containerId: rekey.plan.containerId,
          containerKeyEpoch: nextKek.containerKeyEpoch,
          containerKeyEpochId: nextKek.containerKeyEpochId,
          containerManifestHash: rekey.plan.manifestHash,
        };
        return [firstRekey, rekey];
      },
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
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
    expect(rekeyManifestHashes).toHaveLength(4);
    expect(rekeyManifestHashes[0]).not.toBe(rekeyManifestHashes[2]);
    expect(events).toEqual([
      "get-projection-1",
      "build-rekey-1",
      "submit-1",
      "cache-policies",
      "evict-projection",
      "get-projection-2",
      "build-rekey-2",
      "submit-2",
      "clear-projections",
      "evict-projection",
    ]);
    await expect(
      buildMaterializedDocumentSyncPlan({
        author,
        execSql,
        localVersionVector: null,
        pendingUpdates: [],
        resolveProjectionUserKey,
        targetSecretKey: secretKey,
        writerProjection,
      }),
    ).rejects.toThrow("older than the local checkpoint");
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

test("response-loss recovery does not commit a second inline rekey", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const pendingUpdates = [createPendingUpdateRecord()];
  const submittedRequests: DocumentSyncRequest[] = [];
  let committedRekeyCount = 0;
  let projectionEvictionCount = 0;
  let rekeyBuildCount = 0;
  const { close, execSql } = await createTestExecSql(
    `sync-rekey-update-id-recovery-${crypto.randomUUID()}`,
  );
  await ensureDocumentTables(execSql);

  try {
    const runSync = () =>
      syncRemoteDocument({
        apiClient: {
          evictDocumentWriterProjection: () => {
            projectionEvictionCount += 1;
          },
          getDocumentWriterProjection: async () => writerProjection,
          syncDocument: async () => {
            throw new Error("Expected syncDocumentResult to handle sync");
          },
          syncDocumentResult: async (documentId, request) => {
            submittedRequests.push(request);
            if (submittedRequests.length === 1) {
              committedRekeyCount += request.containerRekeys?.length ?? 0;
              throw new Error("Simulated lost document sync response");
            }
            if (submittedRequests.length === 2) {
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
        buildContainerRekeys: async (currentProjection, verification) => {
          rekeyBuildCount += 1;
          const previousProjection =
            currentProjection.authorizingContainerPaths[0];
          if (!previousProjection) {
            throw new Error("Expected an authorizing container projection");
          }
          return [
            await buildMaterializedContainerRekeyPlan({
              author,
              execSql,
              ...verification,
              previousProjection,
              resolveProjectionUserKey,
              targetSecretKey: secretKey,
            }),
          ];
        },
        buildRotationSnapshot: createFullHistoryRotationSnapshot,
        documentId: writerProjection.documentId,
        execSql,
        localVersionVector: null,
        pendingUpdates,
        resolveProjectionUserKey,
        resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
        targetSecretKey: secretKey,
      });

    await expect(runSync()).rejects.toThrow(
      "Simulated lost document sync response",
    );
    const synced = await runSync();

    expect(synced).not.toBeNull();
    expect(committedRekeyCount).toBe(1);
    expect(projectionEvictionCount).toBe(1);
    expect(rekeyBuildCount).toBe(2);
    expect(
      submittedRequests.map((request) => request.containerRekeys?.length ?? 0),
    ).toEqual([1, 1, 0]);
  } finally {
    close();
  }
});

test("persisted read-only sync does not invoke an available rekey builder", async () => {
  const {
    author,
    resolveProjectionUserKey,
    secretKey,
    signingPublicKey,
    writerProjection,
  } = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    `sync-persisted-rekey-builder-${crypto.randomUUID()}`,
  );
  const materialized = await buildMaterializedDocumentSyncPlan({
    author,
    execSql,
    localVersionVector: null,
    pendingUpdates: [],
    resolveProjectionUserKey,
    targetSecretKey: secretKey,
    writerProjection,
  });
  let builderCalls = 0;
  let projectionCalls = 0;

  try {
    const synced = await syncRemoteDocument({
      apiClient: {
        getDocumentWriterProjection: async () => {
          projectionCalls += 1;
          return writerProjection;
        },
        syncDocument: async (documentId, request) =>
          createSyncResponse({ ...materialized.plan, documentId, request }),
      },
      author,
      buildContainerRekeys: async () => {
        builderCalls += 1;
        return [];
      },
      documentId: writerProjection.documentId,
      execSql,
      localVersionVector: null,
      persistedState: {
        contentKeyBundle: JSON.stringify(writerProjection.contentKeyBundle),
        documentId: writerProjection.documentId,
        documentKekTargets: JSON.stringify(writerProjection.documentKekTargets),
        documentManifestBundle: JSON.stringify(
          writerProjection.documentManifest,
        ),
      },
      resolveProjectionUserKey,
      resolveWriterPublicKey: writerKeyResolver({ author, signingPublicKey }),
      targetSecretKey: secretKey,
    });

    expect(synced).not.toBeNull();
    expect(builderCalls).toBe(0);
    expect(projectionCalls).toBe(0);
  } finally {
    close();
  }
});
