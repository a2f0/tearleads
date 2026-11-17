import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { unwrapDek, wrapDekForRecipients } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestUser } from "@tearleads/test-utils";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  prepareUserForAdminGroup,
  prepareUserRemovalFromAdminGroup,
} from "../../../test/helpers/organizationAdmin";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import {
  buildOrganizationGroupDeletionRequest,
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

  // The same Admins removal with a rotated directory commits: the refusal
  // above is the kept key, not the removal.
  const retried = await submitOrganizationGroupPolicyCommit({
    actor: f.owner,
    groupId: removal.adminGroupId,
    groupPolicy: removal.request,
    organizationId: f.organizationId,
  });
  expect(retried.status).toBe(200);
  const rotated = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    f.organizationId,
  );
  expect(rotated.currentState.version).toBe(directory.currentState.version + 1);
  expect(rotated.currentState.keyEpoch).toBe(
    directory.currentState.keyEpoch + 1,
  );
  expect(
    (
      await runGetCurrentPrincipalPolicyWorkflow(
        db,
        "group",
        removal.adminGroupId,
      )
    ).currentState.version,
  ).toBe(admins.currentState.version + 1);
  const envelopes = rotated.currentMemberEnvelopes.envelopes.map(
    (envelope) => ({
      keyFingerprint: envelope.memberKeyFingerprint,
      kemCipherText: base64ToBytes(envelope.kemCipherText),
      wrappedKey: base64ToBytes(envelope.wrappedKey),
    }),
  );
  const successorKey = await unwrapDek(envelopes, f.owner.kem.secretKey);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  expect(
    await unwrapDek(
      await wrapDekForRecipients(challenge, [
        base64ToBytes(rotated.currentState.encapsulationPublicKey),
      ]),
      successorKey,
    ),
  ).toEqual(challenge);
  expect(
    rotated.currentMemberEnvelopes.envelopes.some(
      (envelope) => envelope.userId === f.admin.userId,
    ),
  ).toBe(false);
  await expect(unwrapDek(envelopes, f.admin.kem.secretKey)).rejects.toThrow();
});

test("group create and delete commit directory successors that keep the organization key", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const directory = () =>
    runGetCurrentPrincipalPolicyWorkflow(db, "organization", organizationId);
  const expectKept = (
    before: Awaited<ReturnType<typeof directory>>,
    after: Awaited<ReturnType<typeof directory>>,
  ) => {
    expect(after.currentState.version).toBe(before.currentState.version + 1);
    expect(after.currentState).toMatchObject({
      encapsulationPublicKey: before.currentState.encapsulationPublicKey,
      keyEpoch: before.currentState.keyEpoch,
      keyFingerprint: before.currentState.keyFingerprint,
      memberEnvelopesRoot: before.currentState.memberEnvelopesRoot,
    });
  };
  const path = `/organizations/${organizationId}/groups`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${owner.token}`,
  };
  const groupId = crypto.randomUUID();
  const beforeCreate = await directory();
  const created = await requestPreparedPrincipalPolicy(path, {
    method: "POST",
    headers,
    body: JSON.stringify(
      await createGroupRequest({
        actor: owner,
        groupId,
        keepKeyWith: owner.kem.secretKey,
        name: "Operators",
      }),
    ),
  });
  expect(created.status).toBe(200);
  await created.arrayBuffer();
  const afterCreate = await directory();
  expectKept(beforeCreate, afterCreate);

  const deleted = await requestPreparedPrincipalPolicy(`${path}/${groupId}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify(
      await buildOrganizationGroupDeletionRequest({
        actor: owner,
        groupId,
        keepKeyWith: owner.kem.secretKey,
        organizationId,
      }),
    ),
  });
  expect(deleted.status).toBe(200);
  await deleted.arrayBuffer();
  expectKept(afterCreate, await directory());
});
