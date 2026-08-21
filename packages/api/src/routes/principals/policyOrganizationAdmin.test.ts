import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { groups } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { isCommitOrganizationGroupPolicyResponse } from "@symcrypt/validators/response";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import {
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";

function putPolicy(
  actor: ReturnType<typeof createTestUser>,
  organizationId: string,
  groupId: string,
  signed: Awaited<ReturnType<typeof createSignedPrincipalState>>,
) {
  return submitOrganizationGroupPolicyCommit({
    actor,
    groupId,
    groupPolicy: {
      state: signed.state,
      encryptedPayload: signed.encryptedPayload,
      grants: signed.grants,
      projection: signed.projection,
      memberEnvelopes: signed.memberEnvelopes,
    },
    organizationId,
  });
}

test("a direct group admin cannot manage policy without built-in Admins authority", async () => {
  const orgAdmin = createTestUser();
  await registerUser(orgAdmin);
  await authenticate(orgAdmin);
  const organizationId = await getDefaultOrganizationId(orgAdmin.userId);
  const groupAdmin = createTestUser();
  await registerUser(groupAdmin);
  await authenticate(groupAdmin);
  await addOrganizationMember({
    actor: orgAdmin,
    member: groupAdmin,
    organizationId,
  });

  const groupId = crypto.randomUUID();
  await db.insert(groups).values({
    id: groupId,
    organizationId,
    name: "Operators",
  });
  const projection = [
    { userId: orgAdmin.userId, role: "admin" as const },
    { userId: groupAdmin.userId, role: "admin" as const },
  ];
  const initial = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    members: projection.map((member) => ({ userId: member.userId })),
    projection,
    signerUserId: orgAdmin.userId,
    signerUserKeyFingerprint: orgAdmin.fingerprint,
    signingPrivateKey: orgAdmin.signing.signingPrivateKey,
  });
  const initialResponse = await putPolicy(
    orgAdmin,
    organizationId,
    groupId,
    initial,
  );
  expect(initialResponse.status).toBe(200);
  const initialBundle = await initialResponse.json();
  invariant(
    isCommitOrganizationGroupPolicyResponse(initialBundle),
    "expected compound principal policy response",
  );
  const currentState = initialBundle.groupPolicy.currentState;
  const successor = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    version: 2,
    prevStateHash: currentState.stateHash,
    keyEpoch: currentState.keyEpoch,
    members: projection.map((member) => ({ userId: member.userId })),
    projection,
    signerUserId: groupAdmin.userId,
    signerUserKeyFingerprint: groupAdmin.fingerprint,
    signingPrivateKey: groupAdmin.signing.signingPrivateKey,
  });

  const response = await putPolicy(
    groupAdmin,
    organizationId,
    groupId,
    successor,
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: "Organization admin required",
  });
}, 10_000);
