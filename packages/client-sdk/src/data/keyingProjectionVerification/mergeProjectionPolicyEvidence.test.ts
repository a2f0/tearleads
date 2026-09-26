import { expect, test } from "bun:test";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import { mergeProjectionPolicyEvidence } from "./mergeProjectionPolicyEvidence";

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
  expect(merged.organizationPayloads).toBe(newer.organizationPayloads);
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
