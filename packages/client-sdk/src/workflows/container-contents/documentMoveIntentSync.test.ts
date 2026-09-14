import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  CONTAINER_UNAVAILABLE_ERROR_CODE,
} from "@tearleads/validators/response";
import { runQueuedDocumentMoveFixture } from "../../../test/helpers/queuedDocumentMoveFixture";
import { createDomainScope } from "../../data/domainScope";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { defaultDocumentsPersistence } from "../documents";
import { createTestContainerState } from "./container-state/containerState.testFixtures";
import { syncPendingDocumentMoveIntents } from "./documentMoveIntentSync";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

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
  expect(typeof fixture.relinkInputs[0]?.stillCurrent).toBe("function");
  expect(fixture.relinkInputs[0]?.stillCurrent?.()).toBe(true);
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
        isCurrent: () => true,
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
        isCurrent: () => true,
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
      isCurrent: () => true,
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
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      state: firstLaunchState,
    });
    expect(await readStatuses()).toEqual(["denied"]);

    // A fresh store state (relaunch) replays it again.
    await syncPendingDocumentMoveIntents({
      host,
      isCurrent: () => true,
      isRemoteSyncBlocked: () => false,
      state: makeState(),
    });
    expect(await readStatuses()).toEqual(["blocked"]);
  } finally {
    await close();
  }
});

// #2278 #4: a coded `container_unavailable` 409 is the server's proof that a
// cited container was deleted between the projection fetch and the commit.
// Container ids never come back, so the intent stops being a retriable
// "rejected" failure and parks terminally as `unavailable`: unlike a local
// `blocked` verdict it leaves the replay set, so later passes issue no remote
// requests against the deleted container. Only the local tombstone cascade
// (retarget) or a fresh enqueue revives it.
test("a link refused for a deleted destination parks the move without replay", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: {
      code: CONTAINER_UNAVAILABLE_ERROR_CODE,
      message: "targetContainerPathRefs[1] container unavailable",
      status: 409,
    },
    passes: 2,
    testDbName: "containerContents-document-move-destination-unavailable",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move cites a container deleted on the server: targetContainerPathRefs[1] container unavailable (409)",
      syncStatus: "unavailable",
    },
  ]);
  // Pass 1 reached the server and was refused with the coded 409.
  expect(fixture.passes[0]?.remoteRequests).toContain("link");
  // Pass 2 skipped the parked intent entirely: no preflight, no remote call.
  expect(fixture.passes[1]).toEqual({
    remoteRequests: [],
    submittedOperations: [],
    syncedCount: 0,
  });
  expect(fixture.pendingIntents).toEqual([]);
});

// An uncoded 409 proves nothing permanent (a stale head, a lock race) and
// keeps its retriable verdict.
test("an uncoded 409 on a link stays a retriable rejection", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    linkFailure: {
      message: "targetContainerPathRefs[1] is stale",
      status: 409,
    },
    testDbName: "containerContents-document-move-uncoded-conflict",
    unlinkAvailable: true,
  });

  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move was rejected or unavailable: targetContainerPathRefs[1] is stale (409)",
      syncStatus: "pending",
    },
  ]);
});

// The pre-mutation projection fetch carries the same proof as a coded 404.
test("a coded container 404 on the destination projection parks the move without replay", async () => {
  const fixture = await runQueuedDocumentMoveFixture({
    containerProjectionFailure: {
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      message: "Container not found",
      status: 404,
    },
    passes: 2,
    testDbName: "containerContents-document-move-destination-not-found",
    unlinkAvailable: true,
  });

  expect(fixture.syncedCount).toBe(0);
  expect(fixture.intentRows).toEqual([
    {
      lastError:
        "Remote document move cites a container deleted on the server: Container not found (404)",
      syncStatus: "unavailable",
    },
  ]);
  expect(fixture.passes[0]?.remoteRequests).toContain("container-projection");
  expect(fixture.passes[1]?.remoteRequests).toEqual([]);
});
