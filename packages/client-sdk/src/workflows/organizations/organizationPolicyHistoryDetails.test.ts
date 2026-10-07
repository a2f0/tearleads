import { afterEach, expect, test } from "bun:test";
import { computePrincipalStatePayloadCiphertextHash } from "@tearleads/crypto";
import {
  createOrganizationHistoryPageFixture,
  organizationHistoryPage,
} from "../../../test/helpers/organizationHistoryPage";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
} from "../../../test/helpers/projectionPolicyHistory";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../data/principals/organizationAuthorityDescriptor";
import { buildDetailedOrganizationPolicyHistory } from "./organizationPolicyHistoryDetails";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
});
async function fixture() {
  const value = await createOrganizationHistoryPageFixture();
  cleanups.push(value.close);
  return value;
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
    ...organizationHistoryPage(data.afterDeletion),
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
  const payload = input.evidence.evidence.organizationPayloads[1]?.payload;
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
    "directory page is incomplete",
    "directory payload scope or order is invalid",
    "response does not match the requested organization page",
  ];
  for (const [index, alter] of [
    (value: Awaited<ReturnType<typeof fixture>>["input"]) => {
      value.evidence.evidence.organizationPayloads.pop();
    },
    (value: Awaited<ReturnType<typeof fixture>>["input"]) => {
      const first = value.evidence.evidence.organizationPayloads[0];
      if (!first) throw new Error("Expected first payload");
      value.evidence.evidence.organizationPayloads[1] = first;
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

test("rejects group membership tampering and a missing group source", async () => {
  const { data, input, http } = await fixture();
  http.controls.mutate = (page) => {
    if (page.currentState.principalId === data.added.currentState.principalId) {
      const member = page.currentProjection[0];
      if (member) member.userId = crypto.randomUUID();
    }
  };
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow();
  input.evidence.evidence.groups.pop();
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "unexpected group source",
  );
});

test("rejects a valid older group policy substituted for the committed membership update", async () => {
  const { data, input } = await fixture();
  input.evidence.evidence.groups[input.evidence.evidence.groups.length - 1] =
    projectionPolicySource(data.created);
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "group source extends beyond the page's signed directory",
  );
});

test("history describes grants, permission and role changes, removals, and key rotation", async () => {
  const { data, input, http } = await fixture();
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
  for (const bundle of [afterRemoval, granted, upgraded, removed])
    http.retain(bundle);
  const result = await buildDetailedOrganizationPolicyHistory({
    ...input,
    ...organizationHistoryPage(afterRemoval),
    evidence: {
      organizationId: data.organizationId,
      stateHash: afterRemoval.currentState.stateHash,
      beforeVersion: afterRemoval.currentState.version + 1,
      nextBeforeVersion: null,
      evidence: {
        organization: projectionPolicySource(afterRemoval),
        organizationPayloads: [
          data.initial,
          data.afterCreation,
          data.afterAddition,
          afterGrant,
          afterUpgrade,
          afterRemoval,
        ].map(projectionDirectoryPayload),
        groups: [data.admin, data.memberPolicy, removed].map(
          projectionPolicySource,
        ),
      },
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
  input.evidence.evidence.groups.push(
    projectionPolicySource(await data.createGroup("Unreferenced")),
  );
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "unexpected group source",
  );
});

test("rejects a newer signed group head beyond the selected organization version", async () => {
  const { data, input } = await fixture();
  const newer = await data.advanceGroup(
    data.added,
    data.added.currentProjection,
    [],
  );
  input.evidence.evidence.groups[input.evidence.evidence.groups.length - 1] =
    projectionPolicySource(newer);
  await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
    "group source extends beyond the page's signed directory",
  );
});

test("a 32-entry organization page uses its actual boundary predecessor for group changes", async () => {
  const { data, input, http } = await fixture();
  const directories = [data.initial, data.afterCreation];
  let directory = data.afterCreation;
  while (directory.currentState.version < 65) {
    directory = await data.advanceDirectory(
      directory,
      directory.currentState.version < 33 ? data.created : data.added,
    );
    directories.push(directory);
  }
  http.retain(directory);
  const result = await buildDetailedOrganizationPolicyHistory({
    ...input,
    ...organizationHistoryPage(directory),
    evidence: {
      organizationId: data.organizationId,
      stateHash: directory.currentState.stateHash,
      beforeVersion: 66,
      nextBeforeVersion: 34,
      evidence: {
        organization: projectionPolicySource(directory),
        organizationPayloads: directories
          .filter((bundle) => bundle.currentState.version >= 33)
          .map(projectionDirectoryPayload),
        groups: [data.admin, data.memberPolicy, data.added].map(
          projectionPolicySource,
        ),
      },
    },
  });
  expect(result.entries).toHaveLength(32);
  expect(result.nextBeforeVersion).toBe(34);
  expect(result.entries.at(-1)).toMatchObject({
    version: 34,
    groupChanges: [
      {
        changeType: "updated",
        previousVersion: 1,
        version: 2,
        changes: [{ changeType: "added", userId: data.targetUserId }],
      },
    ],
  });
  expect(
    result.entries
      .slice(0, -1)
      .every((entry) => entry.groupChanges?.length === 0),
  ).toBe(true);
}, 30_000);

test.each(["beforeVersion", "nextBeforeVersion"] as const)(
  "refuses a server-substituted %s cursor before loading group history",
  async (field) => {
    const { input, http } = await fixture();
    input.evidence = { ...input.evidence, [field]: 99 };
    await expect(buildDetailedOrganizationPolicyHistory(input)).rejects.toThrow(
      "requested organization page",
    );
    expect(http.requests).toHaveLength(0);
  },
);
