import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { addUserToAdminGroup } from "../../../test/helpers/organizationAdmin";
import { withGroupMembershipContainerMutations } from "../../../test/helpers/organizationMembershipGrants";
import { prepareOrganizationPolicyAdvance } from "../../../test/helpers/organizationPolicyOutcome";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  createSignedPrincipalState,
  getDefaultOrganizationId,
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";

test("standalone outcome replay checks the requester's current organization authority", async () => {
  const actor = createTestUser();
  const successor = createTestUser();
  await registerAndAuthenticate(actor, successor);
  const organizationId = await getDefaultOrganizationId(successor.userId);
  const adminGroupId = await addUserToAdminGroup({
    actor: successor,
    member: actor,
    organizationId,
  });
  const original = await prepareOrganizationPolicyAdvance(
    actor,
    organizationId,
  );
  const committed = await requestPreparedPrincipalPolicy(
    original.path,
    original.init,
  );
  expect(committed.status).toBe(200);
  await committed.arrayBuffer();
  const admins = await loadVerifiedPrincipalPolicy(db, "group", adminGroupId);
  const changedAdmins = await createSignedPrincipalState({
    principalType: "group",
    principalId: adminGroupId,
    groupName: "Admins",
    signerUserId: successor.userId,
    signerUserKeyFingerprint: successor.fingerprint,
    signingPrivateKey: successor.signing.signingPrivateKey,
    members: [{ userId: successor.userId }],
    projection: [{ userId: successor.userId, role: "admin" }],
    grants: admins.grants,
    prevStateHash: admins.stateHash,
    version: admins.version + 1,
    keyEpoch: admins.keyEpoch + 1,
  });
  const demoted = await submitOrganizationGroupPolicyCommit({
    actor: successor,
    groupId: adminGroupId,
    groupPolicy: await withGroupMembershipContainerMutations({
      actor: successor,
      currentPolicy: admins,
      signedState: changedAdmins,
    }),
    organizationId,
  });
  const demotionBody = await demoted.json();
  expect({ status: demoted.status, error: demotionBody.error }).toEqual({
    status: 200,
    error: undefined,
  });
  const replay = await requestPreparedPrincipalPolicy(
    original.path,
    original.init,
  );
  expect(replay.status).toBe(403);
  expect(await replay.json()).toEqual({ error: "Organization admin required" });
}, 15_000);
