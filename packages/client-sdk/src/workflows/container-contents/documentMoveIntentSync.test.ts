import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createDocument, exportFullHistorySnapshot } from "@tearleads/loro";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@tearleads/test-utils";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createLinkSetResponseFromRequest,
  createResponse,
} from "../../../test/helpers/documentFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { defaultDocumentsPersistence } from "../documents";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import { createTestContainerState } from "./container-state/containerState.testFixtures";
import { syncPendingDocumentMoveIntents } from "./documentMoveIntentSync";
import type { DocumentStructuralMutationRelinkInput } from "./documentStructure";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

async function runQueuedDocumentMoveFixture(input: {
  containerProjectionFailure?:
    | { message: string; status: number | null }
    | undefined;
  linkFailure?: { message: string; status: number | null } | undefined;
  replaceLinkedContainers?: boolean | undefined;
  sourceContainerId?: string | null | undefined;
  testDbName: string;
  unlinkAvailable: boolean;
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
    const runtime: ContainerContentsWorkflowRuntime = {
      apiClient: {
        getContainerWriterProjection: async (containerId: string) => {
          if (containerId === rootProjection.containerId) {
            return rootProjection;
          }
          if (containerId === trashProjection.containerId) {
            return trashProjection;
          }
          return null;
        },
        getDocumentWriterProjection: async (documentId: string) =>
          documentId === writerProjection.documentId ? writerProjection : null,
        primeDocumentWriterProjection: () => {},
        ...(input.containerProjectionFailure
          ? {
              getContainerWriterProjectionResult: async () => ({
                message: input.containerProjectionFailure?.message ?? "",
                ok: false as const,
                report: () => {},
                status: input.containerProjectionFailure?.status ?? null,
              }),
            }
          : {}),
        ...(input.linkFailure
          ? {
              linkDocumentResult: async () => ({
                message: input.linkFailure?.message ?? "",
                ok: false as const,
                status: input.linkFailure?.status ?? null,
              }),
            }
          : {}),
        linkDocument: async (
          documentId: string,
          request: DocumentLinkSetMutationRequest,
        ) => {
          submittedOperations.push("link");
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
        },
        unlinkDocument: async (
          documentId: string,
          request: DocumentLinkSetMutationRequest,
        ) => {
          submittedOperations.push("unlink");
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
        },
      } as unknown as ContainerContentsWorkflowRuntime["apiClient"],
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

    const syncedCount = await syncPendingDocumentMoveIntents({
      host: {
        documentWorkflowRuntime: (containerId) => `runtime:${containerId}`,
        openDocumentStore: () => ({
          assertCanRotateContentKey: async () => {
            submittedOperations.push("preflight");
            return rotationSnapshot;
          },
          ensureInitialized: async () => true,
          relink: async (input) => {
            relinkInputs.push(input);
            return {
              containerId: input.containerId,
              documentId: input.documentId,
              id: input.localId,
              title: "Queued move",
              updatedAt: "2026-06-23T00:00:00.000Z",
            };
          },
          requestSync: () => undefined,
          updateRuntime: () => undefined,
        }),
      },
      isRemoteSyncBlocked: () => false,
      state: {
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
      },
    });

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
      pendingIntents,
      relinkInputs,
      submittedOperations,
      syncedCount,
      trashContainerId: trashProjection.containerId,
    };
  } finally {
    close();
  }
}

test("pending document move intents replay signed link-set mutations and clear after success", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "containerContents-document-move-intent-sync",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(1);
  expect(fixture.submittedOperations).toEqual(["preflight", "link", "unlink"]);
  expect(fixture.relinkInputs).toHaveLength(1);
  expect(fixture.relinkInputs[0]).toMatchObject({
    containerId: fixture.trashContainerId,
    documentId: fixture.documentId,
    localId: "queued-move-local",
  });
  expect(fixture.linkedContainerIds).toEqual([fixture.trashContainerId]);
  expect(fixture.pendingIntents).toEqual([]);
});

test("a null-source move replay does not unlink its new target", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    replaceLinkedContainers: false,
    sourceContainerId: null,
    testDbName: "containerContents-document-move-null-source",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(1);
  expect(fixture.submittedOperations).toEqual(["preflight", "link"]);
  expect(fixture.linkedContainerIds).toContain(fixture.trashContainerId);
  expect(fixture.pendingIntents).toEqual([]);
});

// A partial replay (link applied, unlink still pending) must not report
// progress: the structural lane re-arms itself on a positive count, so a
// deterministically failing unlink would hot-loop the pump (issue #1744).
test("a partially applied document move stays pending without reporting progress", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    testDbName: "containerContents-document-move-intent-partial",
    unlinkAvailable: false,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.submittedOperations).toEqual(["preflight", "link", "unlink"]);
  expect(fixture.pendingIntents).toHaveLength(1);
  expect(fixture.pendingIntents[0]).toMatchObject({
    documentId: fixture.documentId,
    lastError: "Remote document move partially applied; retry required",
    syncStatus: "pending",
  });
});

test("document move sync propagates identity failures without recording a retry", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-move-identity-failure",
  );
  const integrityError = new KeyingVerificationError(
    "equivocation",
    "trusted identity changed",
  );

  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: "access-document",
      containerId: "source",
      contentKeyBundle: null,
      documentId: "document",
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "local-document",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "",
      title: "Document",
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "document",
      localId: "local-document",
      sourceContainerId: "source",
      targetContainerId: "target",
    });

    await expect(
      syncPendingDocumentMoveIntents({
        host: {
          documentWorkflowRuntime: () => null,
          openDocumentStore: () => ({
            assertCanRotateContentKey: async () => {
              throw integrityError;
            },
            ensureInitialized: async () => true,
            relink: async () => null,
            requestSync: () => undefined,
            updateRuntime: () => undefined,
          }),
        },
        isRemoteSyncBlocked: () => false,
        state: {
          containersById: new Map([
            [
              "target",
              createTestContainerState({ id: "target", parentId: "root" }),
            ],
          ]),
          resolveProjectionUserKey: async () => null,
          runtime: {
            infra: { execSql },
            util: { log: () => undefined },
          } as unknown as ContainerContentsWorkflowRuntime,
        },
      }),
    ).rejects.toBe(integrityError);

    const pending =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.lastError).toBeNull();
  } finally {
    close();
  }
});

// Row 7: a permission denial parks the intent as denied — out of routine
// structural replays — until the access-restored signal or a manual retry
// flips it back. The failure detail and status stay recorded for the queue.
test("a permission-denied document move parks as denied", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: { message: "Forbidden", status: 403 },
    testDbName: "containerContents-document-move-rejected-status",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  // Excluded from routine replay…
  expect(fixture.pendingIntents).toEqual([]);
  // …but durably parked with its diagnosis.
  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move was rejected or unavailable: Forbidden (403)",
      syncStatus: "denied",
    },
  ]);
});

// A non-permission rejection keeps the pre-existing behavior: the intent
// stays pending and retries on every trigger, with the status recorded.
test("a rejected document move records the failure detail and status", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: { message: "Service unavailable", status: 503 },
    testDbName: "containerContents-document-move-unavailable-status",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.pendingIntents).toHaveLength(1);
  expect(fixture.pendingIntents[0]).toMatchObject({
    lastError:
      "Remote document move was rejected or unavailable: Service unavailable (503)",
    syncStatus: "pending",
  });
});

// Blocked is a diagnosis, not a verdict: the intent keeps replaying and each
// pass re-records its outcome, so it recovers the moment the destination
// appears (hydration, recovery) instead of parking forever.
test("a blocked document move keeps replaying and re-records its reason", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-move-blocked-replay",
  );
  try {
    await defaultDocumentsPersistence.ensureSchema(execSql);
    await defaultDocumentsPersistence.saveDocument(execSql, {
      accessEpoch: 1,
      accessStateHash: "access-document",
      containerId: "source",
      contentKeyBundle: null,
      documentId: "document",
      documentKekTargets: null,
      documentKind: "note",
      documentManifestBundle: null,
      id: "local-document",
      lastCommitLsn: null,
      snapshotEndVersion: "",
      text: "",
      title: "Document",
    });
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "document",
      localId: "local-document",
      sourceContainerId: "source",
      targetContainerId: "missing-target",
    });

    const runOnce = () =>
      syncPendingDocumentMoveIntents({
        host: {
          documentWorkflowRuntime: () => null,
          openDocumentStore: () => ({
            assertCanRotateContentKey: async () => new Uint8Array(),
            ensureInitialized: async () => true,
            relink: async () => null,
            requestSync: () => undefined,
            updateRuntime: () => undefined,
          }),
        },
        isRemoteSyncBlocked: () => false,
        state: {
          containersById: new Map(),
          resolveProjectionUserKey: async () => null,
          runtime: {
            infra: { execSql },
            util: { log: () => undefined },
          } as unknown as ContainerContentsWorkflowRuntime,
        },
      });

    await runOnce();
    const [firstPass] =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
    expect(firstPass).toMatchObject({
      lastError:
        "Document move intent references a missing destination container",
      syncStatus: "blocked",
    });
    const firstAttemptAt = firstPass?.lastAttemptedAt ?? null;
    expect(firstAttemptAt).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 2));
    await runOnce();
    const [secondPass] =
      await sqlDocumentMoveIntentPersistence.listPendingMoveIntents(execSql);
    expect(secondPass?.syncStatus).toBe("blocked");
    // The second pass genuinely retried: its attempt timestamp advanced.
    expect(secondPass?.lastAttemptedAt).not.toBe(firstAttemptAt);
  } finally {
    close();
  }
});

// A cold-cache container projection denial is the same signal as a denied
// link mutation: the fetch keeps its 403 and the move parks (row 7) instead
// of collapsing to a retriable null.
test("a container projection denial parks the move as denied", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    containerProjectionFailure: {
      message: "Container writer projection request failed (403)",
      status: 403,
    },
    testDbName: "queued-move-projection-denied",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.pendingIntents).toEqual([]);
  expect(fixture.intentRows).toEqual([
    {
      lastError: expect.stringContaining("(403)"),
      syncStatus: "denied",
    },
  ]);
});

// One replay per launch, ahead of the scan: a fresh store state (relaunch)
// flips parked denied intents back to pending and attempts them in the same
// pass; within one launch the replay never repeats, so a re-denied intent
// stays parked (row 7).
test("denied moves replay once per launch, before the scan", async () => {
  const { close, execSql } = await createTestExecSql("denied-launch-replay");
  try {
    const makeState = () =>
      ({
        containersById: new Map(),
        resolveProjectionUserKey: async () => null,
        runtime: {
          auth: { isAuthenticated: true, organizationId: "organization" },
          infra: { dbStatus: "ready", execSql },
          state: { domainScope: createDomainScope(), online: true },
          util: { log: () => undefined },
        },
      }) as unknown as Parameters<
        typeof syncPendingDocumentMoveIntents
      >[0]["state"];
    const host = {
      documentWorkflowRuntime: () => null,
      openDocumentStore: () => {
        throw new Error("unreachable: the blocked path never opens a store");
      },
    } as unknown as Parameters<
      typeof syncPendingDocumentMoveIntents
    >[0]["host"];
    const readStatuses = async () =>
      (
        await execSql(
          "SELECT sync_status AS syncStatus FROM document_move_intents",
        )
      ).map((row) => Reflect.get(row, "syncStatus"));

    await defaultDocumentsPersistence.ensureSchema(execSql);
    await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
    await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(execSql, {
      documentId: "replay-remote",
      localId: "replay-missing-local",
      replaceLinkedContainers: false,
      sourceContainerId: "from",
      targetContainerId: "to",
    });
    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "replay-remote",
      message: "denied",
    });

    // First pass of the launch: the replay runs before the scan, so the
    // parked intent is attempted immediately (and re-blocks on its missing
    // local document — the attempt is what matters).
    const firstLaunchState = makeState();
    await syncPendingDocumentMoveIntents({
      host,
      isRemoteSyncBlocked: () => false,
      state: firstLaunchState,
    });
    expect(await readStatuses()).toEqual(["blocked"]);

    // Re-denied within the same launch: no second replay, the scan excludes
    // it, and the intent stays parked.
    await sqlDocumentMoveIntentPersistence.recordMoveIntentError(execSql, {
      denied: true,
      documentId: "replay-remote",
      message: "denied again",
    });
    await syncPendingDocumentMoveIntents({
      host,
      isRemoteSyncBlocked: () => false,
      state: firstLaunchState,
    });
    expect(await readStatuses()).toEqual(["denied"]);

    // A fresh store state (relaunch) replays it again.
    await syncPendingDocumentMoveIntents({
      host,
      isRemoteSyncBlocked: () => false,
      state: makeState(),
    });
    expect(await readStatuses()).toEqual(["blocked"]);
  } finally {
    await close();
  }
});
