import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { defaultDocumentProjectorRegistry } from "../../src/data/documents/documentKinds";
import { createDomainScope } from "../../src/data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../src/data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../src/data/persistence/containers/documentContainerProjectionPersistence";
import { createTestContainerState } from "../../src/workflows/container-contents/container-state/containerState.testFixtures";
import { syncPendingDocumentMoveIntents } from "../../src/workflows/container-contents/documentMoveIntentSync";
import type { DocumentStructuralMutationRelinkInput } from "../../src/workflows/container-contents/documentStructure";
import type { ContainerContentsWorkflowRuntime } from "../../src/workflows/container-contents/runtime";
import {
  defaultDocumentsPersistence,
  relinkRemoteDocument,
} from "../../src/workflows/documents";
import { buildMaterializedDocumentCreatePlan } from "../../src/workflows/documents/create";
import { createRuntimePrincipalPolicyWarmer } from "../../src/workflows/principals/runtimePolicyWarmer";
import { createAuthor, createResponse } from "./documentFixtures";
import { createQueuedDocumentMoveRemote } from "./queuedDocumentMoveRemote";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export interface QueuedDocumentMoveFailure {
  readonly code?: string | undefined;
  readonly message: string;
  readonly status: number | null;
}

export interface QueuedDocumentMovePass {
  /** Writer-projection cache evictions the pass requested, in order. */
  readonly cacheEvictions: readonly string[];
  /** Every API call the pass issued, in order (projection fetches included). */
  readonly remoteRequests: readonly string[];
  readonly submittedOperations: readonly string[];
  readonly syncedCount: number;
}

export async function runQueuedDocumentMoveFixture(input: {
  containerProjectionFailure?: QueuedDocumentMoveFailure | undefined;
  /**
   * Which container's writer-projection fetches fail with
   * `containerProjectionFailure` (default: the trash destination). Other
   * containers keep resolving normally.
   */
  containerProjectionFailureFor?: "root" | "trash" | undefined;
  linkFailure?: QueuedDocumentMoveFailure | undefined;
  /**
   * How many leading link submissions fail with `linkFailure` before the
   * mock accepts them (default: every one). A finite count models a stale
   * cached path that a projection refresh repairs.
   */
  linkFailureTimes?: number | undefined;
  /** Structural passes to run against the same queue (default 1). */
  passes?: number | undefined;
  /**
   * Link the document remotely into a third container ("extra") that the
   * LOCAL link projection does not know about: the verified manifest lists
   * it, local state does not.
   */
  remoteOnlySourceContainer?: boolean | undefined;
  replaceLinkedContainers?: boolean | undefined;
  sourceContainerId?: string | null | undefined;
  testDbName: string;
  unlinkAvailable: boolean;
  unlinkFailure?: QueuedDocumentMoveFailure | undefined;
  /** Leading unlink submissions that fail with `unlinkFailure` (default: all). */
  unlinkFailureTimes?: number | undefined;
}) {
  const { close, execSql } = await createTestExecSql(input.testDbName);

  try {
    const { author, signingPublicKey } = await createAuthor();
    const keyPair = generateKemSeedAndKeyPair();
    const containerFixture = (
      containerId: string,
      parentProjection?: ContainerWriterProjectionResponse,
    ) =>
      createContainerWriterProjectionFixture({
        containerId,
        encapsulationPublicKey: keyPair.publicKey,
        organizationId: author.organizationId,
        ...(parentProjection ? { parentProjection } : {}),
        signerKeyFingerprint: author.signerKeyFingerprint,
        signerPrivateKey: author.signerPrivateKey,
        userId: author.signerUserId,
      });
    const rootProjection = await containerFixture("queued-move-root-container");
    const trashProjection = await containerFixture(
      "queued-move-trash-container",
      rootProjection,
    );
    const extraProjection = input.remoteOnlySourceContainer
      ? await containerFixture("queued-move-extra-container", rootProjection)
      : null;
    const containerProjections = [
      rootProjection,
      trashProjection,
      ...(extraProjection ? [extraProjection] : []),
    ];
    const findProjection = (containerId: string) =>
      containerProjections.find(
        (projection) => projection.containerId === containerId,
      ) ?? null;
    const sourceContainerId =
      input.sourceContainerId === undefined
        ? rootProjection.containerId
        : input.sourceContainerId;
    const localLinkedContainerIds =
      sourceContainerId === null ? [] : [rootProjection.containerId];
    const resolveProjectionUserKey = async (userId: string) =>
      userId === author.signerUserId
        ? createTestTrustedUserIdentity({
            encapsulationPublicKey: keyPair.publicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey,
            userId,
          })
        : null;
    const created = await buildMaterializedDocumentCreatePlan({
      author,
      containerProjection: rootProjection,
      documentId: "queued-move-document",
      execSql,
      resolveProjectionUserKey,
      targetSecretKey: keyPair.secretKey,
    });
    const createdResponse = createResponse(created.plan);
    const rotationDocument = await createDocument("queued-move-rotation");
    rotationDocument.getText("text").update("queued move state");
    rotationDocument.commit();
    const rotationSnapshot = exportFullHistorySnapshot(rotationDocument);
    const initialWriterProjection: DocumentWriterProjectionResponse = {
      authorizingContainerPaths: [rootProjection],
      contentKeyBundle: createdResponse.contentKeyBundle,
      documentContainerManifestHistory: [
        ...rootProjection.path,
        ...rootProjection.containerKeks.flatMap(
          (kek) => kek.containerManifestHistory,
        ),
      ],
      documentId: createdResponse.id,
      documentKekTargets: createdResponse.documentKekTargets,
      documentManifest: createdResponse.accessManifest,
      documentManifestContainerPaths: [[...rootProjection.path]],
      documentManifestHistory: [],
    };
    const documentId = initialWriterProjection.documentId;

    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: createdResponse.accessManifest.manifestHash,
      containerId:
        sourceContainerId === null
          ? trashProjection.containerId
          : rootProjection.containerId,
      contentKeyBundle: null,
      documentId,
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "queued-move-local",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "",
      title: "Queued move",
    });
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
      execSql,
      documentId,
      localLinkedContainerIds,
    );
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId,
      localId: "queued-move-local",
      replaceLinkedContainers: input.replaceLinkedContainers ?? true,
      sourceContainerId,
      targetContainerId: trashProjection.containerId,
    });

    const relinkInputs: DocumentStructuralMutationRelinkInput[] = [];
    const submittedOperations: string[] = [];
    const remoteRequests: string[] = [];
    const cacheEvictions: string[] = [];
    let linkFailuresRemaining = input.linkFailure
      ? (input.linkFailureTimes ?? Number.POSITIVE_INFINITY)
      : 0;
    let unlinkFailuresRemaining = input.unlinkFailure
      ? (input.unlinkFailureTimes ?? Number.POSITIVE_INFINITY)
      : 0;
    const failingProjectionContainerId =
      input.containerProjectionFailureFor === "root"
        ? rootProjection.containerId
        : trashProjection.containerId;
    const remote = createQueuedDocumentMoveRemote({
      containerProjections,
      remoteRequests,
      submittedOperations,
      unlinkAvailable: input.unlinkAvailable,
      writerProjection: initialWriterProjection,
    });
    const runtime: ContainerContentsWorkflowRuntime = {
      apiClient: createMockApiClient({
        listDocumentAttachments: async () => {
          remoteRequests.push("attachments");
          return [];
        },
        getContainerWriterProjection: async (containerId: string) => {
          remoteRequests.push("container-projection");
          return findProjection(containerId);
        },
        getDocumentWriterProjection: async (requestedDocumentId: string) => {
          remoteRequests.push("document-projection");
          return requestedDocumentId === documentId
            ? remote.writerProjection
            : null;
        },
        primeDocumentWriterProjection: () => {},
        evictContainerWriterProjection: (containerId: string) => {
          cacheEvictions.push(`container:${containerId}`);
        },
        evictDocumentWriterProjection: (evictedDocumentId: string) => {
          cacheEvictions.push(`document:${evictedDocumentId}`);
        },
        ...(input.containerProjectionFailure
          ? {
              getContainerWriterProjectionResult: async (
                containerId: string,
              ) => {
                remoteRequests.push("container-projection");
                const data = findProjection(containerId);
                if (containerId !== failingProjectionContainerId && data) {
                  return { data, ok: true as const };
                }
                return {
                  kind: "http" as const,
                  method: "GET" as const,
                  path: `/containers/${containerId}/writer-projection`,
                  statusText: "Forbidden",
                  code: input.containerProjectionFailure?.code,
                  message: input.containerProjectionFailure?.message ?? "",
                  ok: false as const,
                  report: () => {},
                  status: input.containerProjectionFailure?.status ?? null,
                };
              },
            }
          : {}),
        ...(input.linkFailure
          ? {
              linkDocumentResult: async (
                requestedDocumentId: string,
                request: DocumentLinkSetMutationRequest,
              ) => {
                if (linkFailuresRemaining <= 0) {
                  return {
                    data: await remote.submitLink(requestedDocumentId, request),
                    ok: true as const,
                  };
                }
                linkFailuresRemaining -= 1;
                remoteRequests.push("link");
                return {
                  kind: "http" as const,
                  method: "POST" as const,
                  path: `/documents/${documentId}/links`,
                  statusText: "Conflict",
                  report: () => {},
                  code: input.linkFailure?.code,
                  message: input.linkFailure?.message ?? "",
                  ok: false as const,
                  status: input.linkFailure?.status ?? null,
                };
              },
            }
          : {}),
        ...(input.unlinkFailure
          ? {
              unlinkDocumentResult: async (
                requestedDocumentId: string,
                request: DocumentLinkSetMutationRequest,
              ) => {
                if (unlinkFailuresRemaining <= 0) {
                  const data = await remote.submitUnlink(
                    requestedDocumentId,
                    request,
                  );
                  return data
                    ? { data, ok: true as const }
                    : createMockRequestFailure({
                        message: "Mock document unlink unavailable",
                      });
                }
                unlinkFailuresRemaining -= 1;
                remoteRequests.push("unlink");
                return {
                  kind: "http" as const,
                  method: "POST" as const,
                  path: `/documents/${documentId}/unlink`,
                  statusText: "Conflict",
                  report: () => {},
                  code: input.unlinkFailure?.code,
                  message: input.unlinkFailure?.message ?? "",
                  ok: false as const,
                  status: input.unlinkFailure?.status ?? null,
                };
              },
            }
          : {}),
        linkDocument: remote.submitLink,
        unlinkDocument: remote.submitUnlink,
      }) as unknown as ContainerContentsWorkflowRuntime["apiClient"],
      auth: {
        isAuthenticated: true,
        organizationId: author.organizationId,
        userId: author.signerUserId,
      },
      crypto: {
        encapsulationKeyPair: keyPair,
        signingFingerprint: author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: author.signerPrivateKey,
          signingPublicKey,
        },
      },
      infra: {
        blobStore: null as never,
        dbStatus: "ready",
        documentProjectors: defaultDocumentProjectorRegistry,
        execSql,
      },
      resolveTrustedUserIdentity: resolveProjectionUserKey,
      state: {
        containerId: null,
        domainScope: createDomainScope(),
        events: [],
        online: true,
      },
      util: {
        log: () => undefined,
        reportSecurityIncident: async () => undefined,
      },
    };

    if (extraProjection) {
      // Link into "extra" through the real signed link-set path so the
      // verified manifest lists it, then wind the LOCAL link projection back:
      // the divergence models a peer's link this device has not hydrated.
      // Setup traffic must not spend the scenario's failure budgets.
      const scenarioBudgets = {
        link: linkFailuresRemaining,
        unlink: unlinkFailuresRemaining,
      };
      linkFailuresRemaining = 0;
      unlinkFailuresRemaining = 0;
      const preLinkFailures: string[] = [];
      const linked = await relinkRemoteDocument({
        apiClient: runtime.apiClient,
        author,
        documentId,
        execSql,
        onFailure: (failure) => {
          preLinkFailures.push(`${failure.message} (${failure.status})`);
        },
        operation: "link",
        resolveProjectionUserKey,
        targetContainerId: extraProjection.containerId,
        targetSecretKey: keyPair.secretKey,
        warmReferencedPrincipalPolicies:
          createRuntimePrincipalPolicyWarmer(runtime),
      });
      if (!linked) {
        throw new Error(
          `Fixture pre-link into the remote-only source failed: ${preLinkFailures.join("; ")}`,
        );
      }
      await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
        execSql,
        documentId,
        localLinkedContainerIds,
      );
      linkFailuresRemaining = scenarioBudgets.link;
      unlinkFailuresRemaining = scenarioBudgets.unlink;
      submittedOperations.length = 0;
      remoteRequests.length = 0;
    }

    const host: Parameters<typeof syncPendingDocumentMoveIntents>[0]["host"] = {
      documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
      openDocumentStore: () => ({
        assertCanRotateContentKey: async () => {
          submittedOperations.push("preflight");
          return rotationSnapshot;
        },
        ensureInitialized: async () => true,
        relink: async (relinkInput) => {
          relinkInputs.push(relinkInput);
          await relinkInput.commitSideEffect?.(execSql);
          return {
            containerId: relinkInput.containerId,
            documentId: relinkInput.documentId,
            id: relinkInput.localId,
            title: "Queued move",
            updatedAt: "2026-06-23T00:00:00.000Z",
          };
        },
        requestSync: () => undefined,
        updateRuntime: () => undefined,
      }),
    };
    // One state object across passes = one launch (the denied replay runs
    // once), matching a structural lane re-arming against the same store.
    const state = {
      containersById: new Map([
        [
          trashProjection.containerId,
          createTestContainerState({
            id: trashProjection.containerId,
            parentId: rootProjection.containerId,
          }),
        ],
      ]),
      resolveProjectionUserKey,
      runtime,
    };

    const passes: QueuedDocumentMovePass[] = [];
    for (let pass = 0; pass < (input.passes ?? 1); pass += 1) {
      const evictionsBefore = cacheEvictions.length;
      const remoteRequestsBefore = remoteRequests.length;
      const submittedBefore = submittedOperations.length;
      const syncedCount = await syncPendingDocumentMoveIntents({
        host,
        isCurrent: () => true,
        isRemoteSyncBlocked: () => false,
        state,
      });
      passes.push({
        cacheEvictions: cacheEvictions.slice(evictionsBefore),
        remoteRequests: remoteRequests.slice(remoteRequestsBefore),
        submittedOperations: submittedOperations.slice(submittedBefore),
        syncedCount,
      });
    }
    const syncedCount = passes.reduce(
      (total, pass) => total + pass.syncedCount,
      0,
    );

    const pendingIntents =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
    const intentRows = await execSql(
      "SELECT sync_status AS syncStatus, last_error AS lastError FROM document_move_intents",
    );
    const linkedContainerIds =
      await sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        documentId,
      );
    return {
      documentId,
      extraContainerId: extraProjection?.containerId ?? null,
      intentRows,
      linkedContainerIds,
      passes,
      pendingIntents,
      relinkInputs,
      rootContainerId: rootProjection.containerId,
      submittedOperations,
      syncedCount,
      trashContainerId: trashProjection.containerId,
    };
  } finally {
    close();
  }
}
