import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
  MAX_INLINE_CONTAINER_REKEYS,
} from "@tearleads/validators/util";
import {
  createDeepRotatedAncestorFixture,
  createForkedRotatedAncestorFixture,
  createRotatedAncestorFixture,
} from "../../../test/helpers/ancestorRotationRecovery";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import { writerKeyResolver } from "../../../test/helpers/documentFixtures";
import {
  createPendingUpdateRecord,
  createResponseFromRequest,
} from "../../../test/helpers/documentResponseFixtures";
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import { unwrapContainerKekPath } from "../../data/documents/shared/containerKekPath";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "./create";
import { syncRemoteDocument } from "./sync";
import { prepareAutomaticContainerRekeys } from "./syncContainerRekeyPreparation";
import { applyContainerRekeyPlan } from "./syncContainerRekeyProjection";
import { buildRemoteDocumentSyncPlan } from "./syncContainerRekeys";

test("ordinary document sync repairs a stale ancestor chain before encrypting its write", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("automatic-ancestor-repair");
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
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const sync = {
      ...input,
      apiClient: createMockApiClient(),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    await expect(
      prepareAutomaticContainerRekeys(
        { ...sync, documentId: "another-document" },
        projection,
      ),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    const readOnly = await buildRemoteDocumentSyncPlan({
      pendingUpdates: [],
      projection,
      regenerateQueuedCheckpoints: false,
      sync,
    });
    expect(readOnly.plan.request.containerRekeys).toBeUndefined();
    expect(readOnly.plan.request.outgoingUpdates).toEqual([]);
    const write = await buildRemoteDocumentSyncPlan({
      pendingUpdates: [createPendingUpdateRecord()],
      projection,
      regenerateQueuedCheckpoints: false,
      sync,
    });
    const repairs = write.plan.request.containerRekeys;
    expect(repairs).toHaveLength(2);
    const [childRepair, leafRepair] = repairs ?? [];
    if (!childRepair?.keyEpoch || !leafRepair?.keyEpoch)
      throw new Error("Expected both repair epochs");
    expect(Reflect.get(childRepair.event, "objectId")).toBe("child");
    expect(Reflect.get(leafRepair.event, "objectId")).toBe("grandchild");
    expect(Reflect.get(childRepair.keyEpoch, "parentContainerKeyEpochId")).toBe(
      fixture.projection.containerKeks[0]?.containerKeyEpochId,
    );
    expect(Reflect.get(leafRepair.keyEpoch, "parentContainerKeyEpochId")).toBe(
      Reflect.get(childRepair.keyEpoch, "id"),
    );
    expect(write.plan.request.inlineRekeyCommitId).toHaveLength(64);
    expect(write.plan.request.outgoingUpdates).toHaveLength(2);
    expect(Reflect.get(leafRepair.keyEpoch, "id")).toBe(
      write.plan.request.contentKeyBundle?.targets[0]?.containerKeyEpochId,
    );
    // Planning an unacknowledged batch must not advance durable checkpoints.
    const originalKeys = await unwrapContainerKekPath({
      ...input,
      projection: fixture.projection,
      secretKey: fixture.root.secretKey,
    });
    expect(originalKeys.get(fixture.grandchild.epochId)).toEqual(
      fixture.grandchild.key,
    );
  } finally {
    database.close();
  }
});

// Rotation settlement submits only the ordinary local stream and therefore
// supplies no rotation snapshot. Repairing this document's own container there
// would mark the content-key bundle stale with nothing able to heal it — and on
// a chain past the inline limit, only after a standalone prefix had already been
// committed. Such a pass must decline to repair and fail as it did before.
test("a pass that cannot heal a stale bundle declines to repair its ancestors", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("settlement-declines-repair");
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
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const settlement = {
      ...input,
      apiClient: createMockApiClient(),
      // omitted exactly as syncRequest.ts does for allowRecoveryBaseline: false
      documentId: projection.documentId,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    await expect(
      buildRemoteDocumentSyncPlan({
        pendingUpdates: [createPendingUpdateRecord()],
        projection,
        regenerateQueuedCheckpoints: false,
        sync: settlement,
      }),
    ).rejects.toThrow(/ancestor KEK repair/);
  } finally {
    database.close();
  }
});

// A repair committed through the standalone prefix is acknowledged against the
// latest durable pin, and a repaired ancestor is always past epoch 1. On a
// device that has never pinned that ancestor the acknowledgement would reject
// its own repair *after* the server committed it, so the prefix path must pin
// the verified heads before it commits anything. The API regression cannot see
// this: it performs a read-only sync first, which pins the whole path.
test("a cold device can acknowledge repairs it commits through the prefix", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("deep-prefix-document");
  const cold = await createTestExecSql("cold-prefix-acknowledgement");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const committed: string[] = [];
    // Each container on the chain is repaired exactly once, so its pre-repair
    // KEK is the one the stale projection already carries.
    const previousKeks = new Map(
      fixture.projection.containerKeks.map((kek) => [kek.containerId, kek]),
    );
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({
        rekeyContainer: async (containerId, request) => {
          committed.push(containerId);
          const previousKek = previousKeks.get(containerId);
          if (!previousKek) {
            throw new Error(`No pre-repair KEK for ${containerId}`);
          }
          return await createMutationResponseFromRequest(request, previousKek);
        },
      }),
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    // The mock serves no refreshed projection, so preparation stops after the
    // first prefix. What matters is how far it got: a full inline batch was
    // committed and every acknowledgement was accepted on a database holding no
    // prior pin for any of these ancestors. Without pinning the verified heads
    // first, the first acknowledgement rejects its own repair with
    // `stale_predecessor` after the server already committed it.
    await expect(
      prepareAutomaticContainerRekeys(sync, projection),
    ).rejects.toThrow(/could not be refreshed/);
    expect(committed).toHaveLength(MAX_INLINE_CONTAINER_REKEYS);
  } finally {
    staging.close();
    cold.close();
  }
}, 180_000);

// The planner signs repairs as the syncing identity. Adopting the path's own
// organization would leave resolveRotationContext comparing a server-supplied
// value against itself, so a path outside the author's organization is refused
// rather than absorbed.
test("a repair path outside the author's organization is refused", async () => {
  const fixture = await createRotatedAncestorFixture();
  const database = await createTestExecSql("cross-org-ancestor-repair");
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
    const foreign = {
      ...fixture.projection,
      organizationId: "another-organization",
    };
    const projection = {
      ...original,
      authorizingContainerPaths: [foreign],
    };
    const sync = {
      ...input,
      apiClient: createMockApiClient(),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    await expect(
      buildRemoteDocumentSyncPlan({
        pendingUpdates: [createPendingUpdateRecord()],
        projection,
        regenerateQueuedCheckpoints: false,
        sync,
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    database.close();
  }
});

// A refused standalone repair abandons the pass rather than erroring out of the
// sync lane. It is deliberately NOT recorded as a terminal submit failure:
// rekeyContainer answers null for every failure, so a 5xx or offline blip cannot
// be told apart from a 403 after revoked ancestor access, and marking those
// terminal would show queued writes as blocked on a transient error.
test("a refused standalone repair abandons the pass", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("refused-prefix-document");
  const cold = await createTestExecSql("refused-prefix-repair");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const abandoned: string[] = [];
    const terminal: string[] = [];
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({ rekeyContainer: async () => null }),
      buildRotationSnapshot: createFullHistoryRotationSnapshot,
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      onSyncAbandoned: (reason: string) => abandoned.push(reason),
      onTerminalSubmitFailure: (failure: { message: string }) => {
        terminal.push(failure.message);
      },
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    const result = await syncRemoteDocument({
      ...sync,
      pendingUpdates: [createPendingUpdateRecord()],
      writerProjection: projection,
    });
    expect(result).toBeNull();
    expect(abandoned).toEqual(["the server refused an ancestor repair"]);
    expect(terminal).toEqual([]);
  } finally {
    staging.close();
    cold.close();
  }
}, 180_000);

// A document linked into two containers authorizes through both paths, which
// share one stale intermediate. Repairing that intermediate must replace it in
// every path: `replaceRekeyedPathNode` throws a hard predecessor mismatch if a
// path carries a different node, and the projection is the only place the two
// paths are reconciled. Exercised directly, since building a genuinely
// two-linked document needs a full link round-trip.
test("a repaired ancestor is replaced in every linked path", async () => {
  const fixture = await createForkedRotatedAncestorFixture();
  const database = await createTestExecSql("forked-ancestor-projection");
  try {
    const input = { ...fixture.input, execSql: database.execSql };
    const created = await buildMaterializedDocumentCreatePlan({
      ...input,
      containerProjection: fixture.leafA,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leafA,
      response: await createResponseFromRequest(created.plan.request),
    });
    const sharedStale = {
      ...fixture.shared,
      path: [...fixture.pathA.path.slice(0, 2)],
      containerKeks: [...fixture.pathA.containerKeks.slice(0, 2)],
    };
    const repair = await buildMaterializedContainerRekeyPlan({
      ...input,
      previousProjection: sharedStale,
    });
    const applied = await applyContainerRekeyPlan(
      {
        ...original,
        authorizingContainerPaths: [fixture.pathA, fixture.pathB],
      },
      repair,
    );
    const repairedEpochId = repair.plan.containerKeyEpochId;
    for (const path of applied.authorizingContainerPaths) {
      const shared = path.containerKeks.find(
        (kek) => kek.containerId === "shared-intermediate",
      );
      expect(shared?.containerKeyEpochId).toBe(repairedEpochId);
    }
  } finally {
    database.close();
  }
}, 120_000);

// The prefix path refetches between rounds, and a refetched projection is as
// server-supplied as the first. Nothing else proves the replacement names the
// document this repair is for, so a swap mid-repair must be refused.
test("a refetched projection for another document is refused", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("swap-prefix-document");
  const cold = await createTestExecSql("swap-prefix-repair");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const previousKeks = new Map(
      fixture.projection.containerKeks.map((kek) => [kek.containerId, kek]),
    );
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({
        getDocumentWriterProjectionResult: async () => ({
          data: { ...projection, documentId: "a-different-document" },
          ok: true as const,
        }),
        rekeyContainer: async (containerId, request) => {
          const previousKek = previousKeks.get(containerId);
          if (!previousKek) throw new Error(`No KEK for ${containerId}`);
          return await createMutationResponseFromRequest(request, previousKek);
        },
      }),
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    await expect(
      prepareAutomaticContainerRekeys(sync, projection),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    staging.close();
    cold.close();
  }
}, 180_000);

// A server that keeps answering with the same stale chain cannot drive endless
// signed rekeys. Pinning the verified heads before each prefix commit means the
// replay is refused as a rollback — an older manifest than the local checkpoint
// — which stops it well before the depth budget backstop is reached.
test("a server replaying a stale chain cannot drive endless rekeys", async () => {
  const fixture = await createDeepRotatedAncestorFixture(17);
  const staging = await createTestExecSql("replayed-prefix-document");
  const cold = await createTestExecSql("replayed-prefix-repair");
  try {
    const created = await buildMaterializedDocumentCreatePlan({
      ...fixture.input,
      execSql: staging.execSql,
      containerProjection: fixture.leaf,
    });
    const original = documentWriterProjectionFromCreateResponse({
      containerProjection: fixture.leaf,
      response: await createResponseFromRequest(created.plan.request),
    });
    const projection = {
      ...original,
      authorizingContainerPaths: [fixture.projection],
    };
    const previousKeks = new Map(
      fixture.projection.containerKeks.map((kek) => [kek.containerId, kek]),
    );
    let rekeys = 0;
    const sync = {
      ...fixture.input,
      apiClient: createMockApiClient({
        // Always answers with the original stale chain, never the repairs.
        getDocumentWriterProjectionResult: async () => ({
          data: projection,
          ok: true as const,
        }),
        rekeyContainer: async (containerId, request) => {
          rekeys += 1;
          const previousKek = previousKeks.get(containerId);
          if (!previousKek) throw new Error(`No KEK for ${containerId}`);
          return await createMutationResponseFromRequest(request, previousKek);
        },
      }),
      documentId: projection.documentId,
      execSql: cold.execSql,
      localVersionVector: null,
      resolveWriterPublicKey: writerKeyResolver(fixture.root),
      validateIncomingUpdates: () => undefined,
    };
    await expect(
      prepareAutomaticContainerRekeys(sync, projection),
    ).rejects.toThrow(/older than the local checkpoint/);
    // Bounded well under the depth backstop: one prefix, then the replay is
    // refused rather than repaired again.
    expect(rekeys).toBeLessThanOrEqual(MAX_INLINE_CONTAINER_REKEYS);
    expect(rekeys).toBeLessThan(MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH);
  } finally {
    staging.close();
    cold.close();
  }
}, 300_000);
