import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalHistoryProgress } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { eq } from "drizzle-orm";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { prepareOrganizationPolicyAdvance } from "../../../test/helpers/organizationPolicyOutcome";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { clearStoredPolicySnapshotCache } from "../../../test/helpers/principalSnapshotVerificationCache";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { schedulePrincipalHistoryPreparation } from "../../workflows/principals/principalHistoryScheduler";

for (const compound of [false, true]) {
  test(`${compound ? "compound" : "standalone"} policy preparation saturation explicitly reports rollback`, async () => {
    const actor = createTestUser();
    await registerAndAuthenticate(actor);
    const organizationId = await getDefaultOrganizationId(actor.userId);
    const prepared = await prepareOrganizationPolicyAdvance(
      actor,
      organizationId,
    );
    const groupId = crypto.randomUUID();
    if (compound) {
      await createPolicyTestGroup(actor.userId, groupId);
      const groupPolicy = await createSignedPrincipalState({
        principalType: "group",
        principalId: groupId,
        signerUserId: actor.userId,
        signerUserKeyFingerprint: actor.fingerprint,
        signingPrivateKey: actor.signing.signingPrivateKey,
        members: [{ userId: actor.userId }],
      });
      await submitOrganizationGroupPolicyCommit({
        actor,
        organizationId,
        groupId,
        groupPolicy,
        request(path, init) {
          if (typeof init.body !== "string")
            throw new Error("Missing prepared body");
          prepared.path = path;
          prepared.init.body = init.body;
          return new Response(null, { status: 204 });
        },
      });
    }
    const before = await getCurrentPrincipalState(
      "organization",
      organizationId,
      db,
    );
    if (!before) throw new Error("Expected organization head");
    await db
      .delete(principalHistoryProgress)
      .where(eq(principalHistoryProgress.principalId, organizationId));
    clearPrincipalPolicySignatureCaches();
    clearStoredPolicySnapshotCache();
    const gate = Promise.withResolvers<void>();
    // Fill the documented two workers and 64 waiting slots with distinct principals.
    const waiting = Array.from({ length: 66 }, (_, index) =>
      schedulePrincipalHistoryPreparation(
        db,
        { ...before, principalId: crypto.randomUUID() },
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
      if (compound)
        expect(await getCurrentPrincipalState("group", groupId, db)).toBeNull();
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
    if (compound)
      expect(
        (await getCurrentPrincipalState("group", groupId, db))?.version,
      ).toBe(1);
  });
}
