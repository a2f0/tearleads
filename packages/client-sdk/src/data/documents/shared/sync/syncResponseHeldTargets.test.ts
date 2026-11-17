import { expect, test } from "bun:test";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import { createPendingUpdateRecord } from "../../../../../test/helpers/data/documentFixtures";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import { buildMaterializedDocumentSyncPlan } from "../../../../workflows/documents/syncPlan/syncPlanMaterial";
import { sortDocumentTargets } from "../readers";
import { authorizationTargetsForUpdate } from "./syncResponseAuthorization";

test("an update without its target set is refilled from the set the sync expected", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { plan } = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates: [createPendingUpdateRecord()],
    signedAt: "2026-04-27T00:00:00.000Z",
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  const held = authorizationTargetsForUpdate({}, plan);
  // The refill is the set whose hash the request sent as `expectedTargetHash`.
  expect(
    await computeDocumentContentKeyTargetHash(sortDocumentTargets(held)),
  ).toBe(plan.request.expectedTargetHash);
  const [first] = held;
  if (!first) throw new Error("Expected a held target");
  const carried = [{ ...first, containerKeyEpochId: "older-epoch" }];
  expect(
    authorizationTargetsForUpdate({ authorizationTargets: carried }, plan),
  ).toBe(carried);
});
