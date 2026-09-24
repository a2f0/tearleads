import { expect, test } from "bun:test";
import { computePrincipalStatePayloadCiphertextHash } from "@tearleads/crypto";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../data/principals/organizationAuthorityDescriptor";
import { buildDetailedOrganizationPolicyHistory } from "./organizationPolicyHistoryDetails";

async function fixture() {
  const data = await createOrganizationHistoryFixture();
  return {
    data,
    input: {
      bundle: data.afterAddition,
      evidence: data.evidence(),
      organizationId: data.organizationId,
      localCheckpoint: {
        version: data.afterAddition.currentState.version,
        stateHash: data.afterAddition.currentState.stateHash,
        principalId: data.organizationId,
        principalType: "organization" as const,
      },
      resolveTrustedUserIdentity: data.resolveTrustedUserIdentity,
    },
  };
}

test("fresh organization history explains group creation and a later member addition without names", async () => {
  const { data, input } = await fixture();
  const result = await buildDetailedOrganizationPolicyHistory(input);
  expect(result.entries.map((entry) => entry.version)).toEqual([3, 2, 1]);
  expect(result.entries[0]).toMatchObject({
    changes: [],
    groupChanges: [
      {
        groupId: data.created.currentState.principalId,
        changeType: "updated",
        changes: [
          {
            changeType: "added",
            userId: data.targetUserId,
            nextRole: "member",
          },
        ],
      },
    ],
  });
  expect(result.entries[1]).toMatchObject({
    changes: [],
    groupChanges: [{ changeType: "created", changes: [] }],
  });
  expect(JSON.stringify(result)).not.toContain("Private support name");
  expect(JSON.stringify(input.evidence)).not.toContain("Private support name");
});

test("deleted groups retain verifiable history without their encrypted name or keys", async () => {
  const { data, input } = await fixture();
  const result = await buildDetailedOrganizationPolicyHistory({
    ...input,
    bundle: data.afterDeletion,
    evidence: data.evidence(true),
  });
  expect(result.entries[0]?.groupChanges).toMatchObject([
    { groupId: data.created.currentState.principalId, changeType: "deleted" },
  ]);
  expect(result.entries[1]?.groupChanges?.[0]?.changes).toMatchObject([
    { userId: data.targetUserId, changeType: "added" },
  ]);
});

test("rejects an altered directory payload even when its advertised ciphertext hash is recomputed", async () => {
  const { input } = await fixture();
  const payload = input.evidence.organizationPayloads[1];
  if (!payload) throw new Error("Expected historical payload");
  const descriptor = parseOrganizationAuthorityDescriptor(payload.ciphertext);
  payload.ciphertext = encodeOrganizationAuthorityDescriptor({
    ...descriptor,
    adminGroupId: descriptor.memberGroupId,
    memberGroupId: descriptor.adminGroupId,
  });
  payload.ciphertextHash = await computePrincipalStatePayloadCiphertextHash(
    payload.ciphertext,
  );
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "directory payload does not match its signed hash",
  );
});

test("rejects missing or duplicated directory history and wrong organization scope", async () => {
  const messages = [
    "directory history is incomplete",
    "directory payload scope is invalid",
    "response does not match the requested organization head",
  ];
  for (const [index, alter] of [
    (value: Awaited<ReturnType<typeof fixture>>["input"]) => {
      value.evidence.organizationPayloads.pop();
    },
    (value: Awaited<ReturnType<typeof fixture>>["input"]) => {
      const first = value.evidence.organizationPayloads[0];
      if (!first) throw new Error("Expected first payload");
      value.evidence.organizationPayloads[1] = first;
    },
    (value: Awaited<ReturnType<typeof fixture>>["input"]) => {
      value.evidence.organizationId = crypto.randomUUID();
    },
  ].entries()) {
    const { input } = await fixture();
    alter(input);
    await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
      messages[index],
    );
  }
});

test("rejects group membership tampering and a missing group snapshot", async () => {
  const { input } = await fixture();
  const group = input.evidence.groups.at(-1);
  if (!group) throw new Error("Expected group snapshot");
  const member = group.currentProjection[0];
  if (!member) throw new Error("Expected member");
  member.userId = crypto.randomUUID();
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "principal policy projection root does not match projection",
  );
  input.evidence.groups.pop();
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "group history does not match the signed directory",
  );
});

test("rejects a valid older group policy substituted for the committed membership update", async () => {
  const { data, input } = await fixture();
  input.evidence.groups[input.evidence.groups.length - 1] = policySnapshot(
    data.created,
  );
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "group history does not match the signed directory",
  );
});

test("history describes grants, permission and role changes, removals, and key rotation", async () => {
  const { data, input } = await fixture();
  const containerId = crypto.randomUUID();
  const granted = await data.advanceGroup(
    data.added,
    data.added.currentProjection,
    [{ containerId, accessLevel: "read" }],
  );
  const afterGrant = await data.advanceDirectory(data.afterAddition, granted);
  const upgraded = await data.advanceGroup(
    granted,
    [{ userId: data.targetUserId, role: "admin" }],
    [{ containerId, accessLevel: "write" }],
  );
  const afterUpgrade = await data.advanceDirectory(afterGrant, upgraded);
  const removed = await data.advanceGroup(upgraded, [], [], true);
  const afterRemoval = await data.advanceDirectory(afterUpgrade, removed);
  const evidence = data.evidence();
  const result = await buildDetailedOrganizationPolicyHistory({
    ...input,
    bundle: afterRemoval,
    evidence: {
      ...evidence,
      stateHash: afterRemoval.currentState.stateHash,
      organizationPayloads: [
        ...evidence.organizationPayloads,
        afterGrant.currentPayload,
        afterUpgrade.currentPayload,
        afterRemoval.currentPayload,
      ],
      groups: [...evidence.groups.slice(0, -1), policySnapshot(removed)],
    },
  });
  expect(result.entries[2]?.groupChanges?.[0]?.grantChanges).toEqual([
    { containerId, previousAccess: null, nextAccess: "read" },
  ]);
  expect(result.entries[1]?.groupChanges?.[0]).toMatchObject({
    changes: [
      {
        userId: data.targetUserId,
        changeType: "role_changed",
        previousRole: "member",
        nextRole: "admin",
      },
    ],
    grantChanges: [
      { containerId, previousAccess: "read", nextAccess: "write" },
    ],
    previousKeyEpoch: 1,
    keyEpoch: 1,
  });
  expect(result.entries[0]?.groupChanges?.[0]).toMatchObject({
    changes: [
      {
        userId: data.targetUserId,
        changeType: "removed",
        previousRole: "admin",
        nextRole: null,
      },
    ],
    grantChanges: [{ containerId, previousAccess: "write", nextAccess: null }],
    previousKeyEpoch: 1,
    keyEpoch: 2,
  });
});

test("rejects an extra signed group not referenced by the organization directory", async () => {
  const { data, input } = await fixture();
  input.evidence.groups.push(
    policySnapshot(await data.createGroup("Unreferenced")),
  );
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "unexpected group history",
  );
});

test("rejects a newer signed group head beyond the selected organization version", async () => {
  const { data, input } = await fixture();
  const newer = await data.advanceGroup(
    data.added,
    data.added.currentProjection,
    [],
  );
  input.evidence.groups[input.evidence.groups.length - 1] =
    policySnapshot(newer);
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "group history extends beyond the selected organization head",
  );
});
