import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createForkedRotatedAncestorFixture,
  createRotatedAncestorFixture,
} from "../../../test/helpers/ancestorRotationRecovery";
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
