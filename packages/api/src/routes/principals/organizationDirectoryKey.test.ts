import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { unwrapDek } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  prepareUserForAdminGroup,
  prepareUserRemovalFromAdminGroup,
} from "../../../test/helpers/organizationAdmin";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  runGetCurrentPrincipalPolicyWorkflow,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";

async function organizationWithTwoAdmins() {
  const owner = createTestUser();
  const admin = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(admin);
  await authenticate(admin);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const added = await prepareUserForAdminGroup({
    actor: owner,
    member: admin,
    organizationId,
  });
  // Read after preparation, which first enrolls the admin in Members.
  const before = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    organizationId,
  );
  const response = await submitOrganizationGroupPolicyCommit({
    actor: owner,
    groupId: added.adminGroupId,
    groupPolicy: added.request,
    keepKeyWith: owner.kem.secretKey,
    organizationId,
  });
  return { admin, before, organizationId, owner, response };
}

test("an Admins add commits a directory successor that keeps the organization key", async () => {
  const f = await organizationWithTwoAdmins();
  expect(f.response.status).toBe(200);
  const after = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    f.organizationId,
  );
  expect(after.currentState.version).toBe(f.before.currentState.version + 1);
  expect(after.currentState).toMatchObject({
    encapsulationPublicKey: f.before.currentState.encapsulationPublicKey,
    keyEpoch: f.before.currentState.keyEpoch,
    keyFingerprint: f.before.currentState.keyFingerprint,
  });
  // The stored envelopes keep the retained admin's and add the new admin's,
  // which opens the same organization key.
  for (const envelope of f.before.currentMemberEnvelopes.envelopes)
    expect(after.currentMemberEnvelopes.envelopes).toContainEqual(
      expect.objectContaining(envelope),
    );
  const opened = async (userId: string, secretKey: Uint8Array) =>
    unwrapDek(
      after.currentMemberEnvelopes.envelopes
        .filter((envelope) => envelope.userId === userId)
        .map((envelope) => ({
          keyFingerprint: envelope.memberKeyFingerprint,
          kemCipherText: base64ToBytes(envelope.kemCipherText),
          wrappedKey: base64ToBytes(envelope.wrappedKey),
        })),
      secretKey,
    );
  expect(await opened(f.admin.userId, f.admin.kem.secretKey)).toEqual(
    await opened(f.owner.userId, f.owner.kem.secretKey),
  );
});

test("an Admins removal that keeps the organization key is refused whole", async () => {
  const f = await organizationWithTwoAdmins();
  expect(f.response.status).toBe(200);
  const directory = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    f.organizationId,
  );
  const removal = await prepareUserRemovalFromAdminGroup({
    actor: f.owner,
    member: f.admin,
    organizationId: f.organizationId,
  });
  const admins = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "group",
    removal.adminGroupId,
  );
  const response = await submitOrganizationGroupPolicyCommit({
    actor: f.owner,
    groupId: removal.adminGroupId,
    groupPolicy: removal.request,
    keepKeyWith: f.owner.kem.secretKey,
    organizationId: f.organizationId,
  });
  expect(response.status).toBe(409);
  expect(await response.text()).toContain(
    "Principal policy shrink requires a new key epoch and key material",
  );
  // Neither the directory nor Admins advanced.
  expect(
    (
      await runGetCurrentPrincipalPolicyWorkflow(
        db,
        "organization",
        f.organizationId,
      )
    ).currentState.stateHash,
  ).toBe(directory.currentState.stateHash);
  expect(
    (
      await runGetCurrentPrincipalPolicyWorkflow(
        db,
        "group",
        removal.adminGroupId,
      )
    ).currentState.stateHash,
  ).toBe(admins.currentState.stateHash);
});
