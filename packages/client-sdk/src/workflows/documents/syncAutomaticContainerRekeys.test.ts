import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createRotatedAncestorFixture } from "../../../test/helpers/ancestorRotationRecovery";
import { writerKeyResolver } from "../../../test/helpers/documentFixtures";
import {
  createPendingUpdateRecord,
  createResponseFromRequest,
} from "../../../test/helpers/documentResponseFixtures";
import { createFullHistoryRotationSnapshot } from "../../../test/helpers/staleBundleSyncFixture";
import { unwrapContainerKekPath } from "../../data/documents/shared/containerKekPath";
import {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "./create";
import { prepareAutomaticContainerRekeys } from "./syncContainerRekeyPreparation";
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
