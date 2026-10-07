import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
  projectionPolicyWarmer,
} from "../../../test/helpers/projectionPolicyHistory";
import { mergeProjectionPolicyEvidence } from "./mergeProjectionPolicyEvidence";
import { verifyProjectionPolicyEvidence } from "./projectionPolicyEvidence";

test("composed projections preserve older citations using the newer directory and group chains", async () => {
  const data = await createOrganizationHistoryFixture();
  const older = {
    organization: projectionPolicySource(data.afterCreation),
    organizationPayloads: data
      .projectionEvidence()
      .organizationPayloads.slice(0, 2),
    groups: [projectionPolicySource(data.created)],
  };
  const newer = {
    organization: projectionPolicySource(data.afterDeletion),
    organizationPayloads: data.projectionEvidence(true).organizationPayloads,
    groups: data.projectionEvidence(true).groups,
  };
  const merged = mergeProjectionPolicyEvidence([newer, older]);
  expect(merged.organization).toBe(newer.organization);
  expect(merged.organizationPayloads).toEqual(newer.organizationPayloads);
  expect(
    merged.groups.find(
      (group) =>
        group.head.principalId === data.created.currentState.principalId,
    )?.head.stateHash,
  ).toBe(data.added.currentState.stateHash);
  expect(older.groups[0]?.head.version).toBe(1);
});

for (const conflict of ["organization", "group", "principal"] as const) {
  test(`composition refuses a conflicting ${conflict} before caching the projection`, async () => {
    const data = await createOrganizationHistoryFixture();
    const first = {
      organization: projectionPolicySource(data.afterDeletion),
      organizationPayloads: data.projectionEvidence(true).organizationPayloads,
      groups: data.projectionEvidence(true).groups,
    };
    const second = structuredClone(first);
    if (conflict === "group") {
      const group = second.groups[0];
      if (!group) throw new Error("Expected group");
      group.head.stateHash = "f".repeat(64);
    } else if (conflict === "organization")
      second.organization.head.stateHash = "f".repeat(64);
    else second.organization.head.principalId = crypto.randomUUID();
    expect(() => mergeProjectionPolicyEvidence([first, second])).toThrow(
      conflict === "principal" ? "crosses principals" : "conflicting heads",
    );
  });
}

test("composition preserves distinct directory bindings for deleted and live groups", async () => {
  const data = await createOrganizationHistoryFixture();
  const older = {
    organization: projectionPolicySource(data.afterAddition),
    organizationPayloads: [projectionDirectoryPayload(data.afterAddition)],
    groups: data.projectionEvidence().groups,
  };
  const newer = {
    organization: projectionPolicySource(data.afterDeletion),
    organizationPayloads: [projectionDirectoryPayload(data.afterDeletion)],
    groups: data
      .projectionEvidence()
      .groups.filter(
        (group) =>
          group.head.principalId !== data.created.currentState.principalId,
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
          references: merged.groups.map(({ head }) => head),
          warmReferencedPrincipalPolicies: projectionPolicyWarmer({
            execSql: database.execSql,
            bundles: data.projectionBundles,
            resolveUserKey: data.resolveTrustedUserIdentity,
          }),
          organizationId: data.organizationId,
        })
      ).policies.length,
    ).toBe(4);
  } finally {
    database.close();
  }
  const conflicting = structuredClone(older);
  const payload = conflicting.organizationPayloads[0];
  if (!payload) throw new Error("Missing fixture binding");
  payload.payload.ciphertext = "tampered";
  expect(() => mergeProjectionPolicyEvidence([older, conflicting])).toThrow(
    "conflicting directory payloads",
  );
});
