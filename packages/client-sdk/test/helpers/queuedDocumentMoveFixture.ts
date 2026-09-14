import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { defaultDocumentProjectorRegistry } from "../../src/data/documents/documentKinds";
import { createDomainScope } from "../../src/data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../src/data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../src/data/persistence/containers/documentContainerProjectionPersistence";
import { createTestContainerState } from "../../src/workflows/container-contents/container-state/containerState.testFixtures";
import { syncPendingDocumentMoveIntents } from "../../src/workflows/container-contents/documentMoveIntentSync";
import type { DocumentStructuralMutationRelinkInput } from "../../src/workflows/container-contents/documentStructure";
import type { ContainerContentsWorkflowRuntime } from "../../src/workflows/container-contents/runtime";
import { defaultDocumentsPersistence } from "../../src/workflows/documents";
import { buildMaterializedDocumentCreatePlan } from "../../src/workflows/documents/create";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
} from "./documentFixtures";
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
    const rootProjection = await createContainerWriterProjectionFixture({
      containerId: "queued-move-root-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const trashProjection = await createContainerWriterProjectionFixture({
      containerId: "queued-move-trash-container",
      encapsulationPublicKey: keyPair.publicKey,
      organizationId: author.organizationId,
      parentProjection: rootProjection,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    });
    const sourceContainerId =
      input.sourceContainerId === undefined
        ? rootProjection.containerId
        : input.sourceContainerId;
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
    let writerProjection: DocumentWriterProjectionResponse = {
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

    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: createdResponse.accessManifest.manifestHash,
      containerId:
        sourceContainerId === null
          ? trashProjection.containerId
          : rootProjection.containerId,
      contentKeyBundle: null,
      documentId: writerProjection.documentId,
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
      writerProjection.documentId,
      sourceContainerId === null ? [] : [rootProjection.containerId],
    );
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: writerProjection.documentId,
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
    // The accepted unlink: shared by the plain mock and by the failing
    // `unlinkDocumentResult` override once its failure budget is spent.
    const submitUnlink = async (
      documentId: string,
      request: DocumentLinkSetMutationRequest,
    ) => {
      submittedOperations.push("unlink");
      remoteRequests.push("unlink");
      if (!input.unlinkAvailable) {
        return null;
      }
      const response = await createLinkSetResponseFromRequest(
        documentId,
        request,
      );
      writerProjection = {
        authorizingContainerPaths: [trashProjection],
        contentKeyBundle: response.contentKeyBundle,
        documentContainerManifestHistory: [
          ...writerProjection.documentContainerManifestHistory,
        ],
        documentId: response.id,
        documentKekTargets: response.documentKekTargets,
        documentManifest: response.accessManifest,
        documentManifestContainerPaths: [
          ...writerProjection.documentManifestContainerPaths,
        ],
        documentManifestHistory: [
          writerProjection.documentManifest,
          ...writerProjection.documentManifestHistory,
        ],
      };
      return response;
    };
    // The accepted link: shared by the plain mock and by the failing
    // `linkDocumentResult` override once its failure budget is spent.
    const submitLink = async (
      documentId: string,
      request: DocumentLinkSetMutationRequest,
    ) => {
      submittedOperations.push("link");
      remoteRequests.push("link");
      const response = await createLinkSetResponseFromRequest(
        documentId,
        request,
      );
      writerProjection = {
        authorizingContainerPaths: [rootProjection, trashProjection],
        contentKeyBundle: response.contentKeyBundle,
        documentContainerManifestHistory: [
          ...writerProjection.documentContainerManifestHistory,
          ...trashProjection.path,
          ...trashProjection.containerKeks.flatMap(
            (kek) => kek.containerManifestHistory,
          ),
        ],
        documentId: response.id,
        documentKekTargets: response.documentKekTargets,
        documentManifest: response.accessManifest,
        documentManifestContainerPaths: [
          ...writerProjection.documentManifestContainerPaths,
          [...trashProjection.path],
        ],
        documentManifestHistory: [
          writerProjection.documentManifest,
          ...writerProjection.documentManifestHistory,
        ],
      };
      return response;
    };
    const runtime: ContainerContentsWorkflowRuntime = {
      apiClient: createMockApiClient({
        listDocumentAttachments: async () => {
          remoteRequests.push("attachments");
          return [];
        },
        getContainerWriterProjection: async (containerId: string) => {
          remoteRequests.push("container-projection");
          if (containerId === rootProjection.containerId) {
            return rootProjection;
          }
          if (containerId === trashProjection.containerId) {
            return trashProjection;
          }
          return null;
        },
        getDocumentWriterProjection: async (documentId: string) => {
          remoteRequests.push("document-projection");
          return documentId === writerProjection.documentId
            ? writerProjection
            : null;
        },
        primeDocumentWriterProjection: () => {},
        evictContainerWriterProjection: (containerId: string) => {
          cacheEvictions.push(`container:${containerId}`);
        },
        evictDocumentWriterProjection: (documentId: string) => {
          cacheEvictions.push(`document:${documentId}`);
        },
        ...(input.containerProjectionFailure
          ? {
              getContainerWriterProjectionResult: async (
                containerId: string,
              ) => {
                remoteRequests.push("container-projection");
                if (containerId !== failingProjectionContainerId) {
                  const data =
                    containerId === rootProjection.containerId
                      ? rootProjection
                      : trashProjection;
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
                documentId: string,
                request: DocumentLinkSetMutationRequest,
              ) => {
                if (linkFailuresRemaining <= 0) {
                  return {
                    data: await submitLink(documentId, request),
                    ok: true as const,
                  };
                }
                linkFailuresRemaining -= 1;
                remoteRequests.push("link");
                return {
                  kind: "http" as const,
                  method: "POST" as const,
                  path: `/documents/${writerProjection.documentId}/links`,
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
                documentId: string,
                request: DocumentLinkSetMutationRequest,
              ) => {
                if (unlinkFailuresRemaining <= 0) {
                  const data = await submitUnlink(documentId, request);
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
                  path: `/documents/${writerProjection.documentId}/unlink`,
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
        linkDocument: submitLink,
        unlinkDocument: submitUnlink,
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
        writerProjection.documentId,
      );
    return {
      documentId: writerProjection.documentId,
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
