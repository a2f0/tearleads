import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import { mergeProjectionPolicyEvidence } from "./mergeProjectionPolicyEvidence";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";

test("composed projections preserve older citations using the newer directory and group chains", async () => {
  const data = await createOrganizationHistoryFixture();
  const older = {
    organization: policySnapshot(data.afterCreation),
    organizationPayloads: data.evidence().organizationPayloads.slice(0, 2),
    groups: [policySnapshot(data.created)],
  };
  const newer = {
    organization: policySnapshot(data.afterDeletion),
    organizationPayloads: data.evidence(true).organizationPayloads,
    groups: data.evidence(true).groups,
  };
  const merged = mergeProjectionPolicyEvidence([newer, older]);
  expect(merged.organization).toBe(newer.organization);
  expect(merged.organizationPayloads).toEqual(newer.organizationPayloads);
  expect(
    merged.groups.find(
      (group) =>
        group.currentState.principalId ===
        data.created.currentState.principalId,
    )?.currentState.stateHash,
  ).toBe(data.added.currentState.stateHash);
  expect(older.groups[0]?.currentState.version).toBe(1);
});

for (const conflict of ["organization", "group", "principal"] as const) {
  test(`composition refuses a conflicting ${conflict} before caching the projection`, async () => {
    const data = await createOrganizationHistoryFixture();
    const first = {
      organization: policySnapshot(data.afterDeletion),
      organizationPayloads: data.evidence(true).organizationPayloads,
      groups: data.evidence(true).groups,
    };
    const second = structuredClone(first);
    if (conflict === "group") {
      const group = second.groups[0];
      if (!group) throw new Error("Expected group");
      group.currentState.stateHash = "f".repeat(64);
    } else if (conflict === "organization")
      second.organization.currentState.stateHash = "f".repeat(64);
    else second.organization.currentState.principalId = crypto.randomUUID();
    expect(() => mergeProjectionPolicyEvidence([first, second])).toThrow(
      conflict === "principal" ? "crosses principals" : "conflicting heads",
    );
  });
}

test("composition preserves distinct directory bindings for deleted and live groups", async () => {
  const data = await createOrganizationHistoryFixture();
  const older = {
    organization: policySnapshot(data.afterAddition),
    organizationPayloads: [data.afterAddition.currentPayload],
    groups: data.evidence().groups,
  };
  const newer = {
    organization: policySnapshot(data.afterDeletion),
    organizationPayloads: [data.afterDeletion.currentPayload],
    groups: data
      .evidence()
      .groups.filter(
        (group) =>
          group.currentState.principalId !==
          data.created.currentState.principalId,
      ),
  };
  const merged = mergeProjectionPolicyEvidence([newer, older]);
  expect(merged.organizationPayloads).toHaveLength(2);
  const database = createNativeTestExecSql();
  try {
    expect(
      (
        await verifyProjectionPolicyEvidence({
          evidence: merged,
          execSql: database.execSql,
          organizationId: data.organizationId,
          resolveUserKey: data.resolveTrustedUserIdentity,
        })
      ).length,
    ).toBe(4);
  } finally {
    database.close();
  }
  const conflicting = structuredClone(older);
  const payload = conflicting.organizationPayloads[0];
  if (!payload) throw new Error("Missing fixture binding");
  payload.ciphertext = "tampered";
  expect(() => mergeProjectionPolicyEvidence([older, conflicting])).toThrow(
    "conflicting directory payloads",
  );
});
