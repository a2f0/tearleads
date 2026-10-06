import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryIndexNodes,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { prepareOrganizationPolicyAdvance } from "../../../test/helpers/organizationPolicyOutcome";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { schedulePrincipalHistoryPreparation } from "../../workflows/principals/principalHistoryScheduler";
import { clearStoredPolicySnapshotCache } from "../../workflows/principals/snapshotVerificationCache";

test("a saturated policy preparation queue explicitly reports rollback", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const prepared = await prepareOrganizationPolicyAdvance(
    actor,
    organizationId,
  );
  const before = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!before) throw new Error("Expected organization head");
  await db.delete(principalHistoryProgress);
  await db.delete(principalHistoryIndexNodes);
  clearPrincipalPolicySignatureCaches();
  clearStoredPolicySnapshotCache();
  const gate = Promise.withResolvers<void>();
  const waiting = Array.from({ length: 66 }, (_, index) =>
    schedulePrincipalHistoryPreparation(
      db,
      {
        ...before,
        principalId: crypto.randomUUID(),
      },
      () => (index < 2 ? gate.promise : Promise.resolve()),
    ).catch((error: unknown) => error),
  );
  try {
    const response = await routeApp.request(prepared.path, prepared.init);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Principal history preparation is busy; retry later",
      code: "principal_history_preparation_unavailable",
      committed: false,
    });
    expect(
      await getCurrentPrincipalState("organization", organizationId, db),
    ).toEqual(before);
  } finally {
    gate.resolve();
    await Promise.all(waiting);
  }
  const retried = await requestPreparedPrincipalPolicy(
    prepared.path,
    prepared.init,
  );
  expect(retried.status).toBe(200);
  expect(
    (await getCurrentPrincipalState("organization", organizationId, db))
      ?.version,
  ).toBe(before.version + 1);
});
