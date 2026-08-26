import { expect, test } from "bun:test";
import type {
  ContainerGrantPrincipalHead,
  VerifiedPrincipalPolicy,
} from "./index";
import {
  resolveContainerPathUserAccessLevel,
  resolveHistoricalContainerPathUserAccessLevel,
} from "./index";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
  fixtureHash,
} from "./testFixtures";

function policyState(
  reference: ContainerGrantPrincipalHead,
): VerifiedPrincipalPolicy["state"] {
  return {
    principalType: reference.principalType,
    principalId: reference.principalId,
    version: reference.version,
    keyEpoch: reference.keyEpoch,
    stateHash: reference.stateHash,
    keyFingerprint: reference.keyFingerprint,
  } as VerifiedPrincipalPolicy["state"];
}

test("historical access resolves membership at the manifest's exact policy head", async () => {
  const historicalHead: ContainerGrantPrincipalHead = {
    principalType: "group",
    principalId: "historical-group",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("historical-group-state-1"),
    keyFingerprint: await fixtureHash("historical-group-key-1"),
  };
  const currentHead: ContainerGrantPrincipalHead = {
    ...historicalHead,
    version: 2,
    keyEpoch: 2,
    stateHash: await fixtureHash("historical-group-state-2"),
    keyFingerprint: await fixtureHash("historical-group-key-2"),
  };
  const formerMember = {
    role: "member",
    userId: "former-member",
  };
  const laterMember = {
    role: "member",
    userId: "later-member",
  };
  const currentPolicy = createPrincipalPolicyFixture(currentHead);
  const policy = {
    ...currentPolicy,
    projection: [laterMember],
    history: [
      {
        grants: [],
        projection: [formerMember],
        state: policyState(historicalHead),
      },
      {
        grants: [],
        projection: [laterMember],
        state: policyState(currentHead),
      },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  const historicalManifest = await createContainerManifestFixture({
    containerId: "historical-membership-container",
    directGrants: [
      {
        accessLevel: "read",
        subjectId: historicalHead.principalId,
        subjectType: "group",
      },
    ],
    referencedPrincipalHeads: [historicalHead],
  });

  expect(
    resolveHistoricalContainerPathUserAccessLevel({
      path: [historicalManifest],
      principalPolicies: [policy],
      userId: formerMember.userId,
    }),
  ).toBe("read");
  expect(
    resolveHistoricalContainerPathUserAccessLevel({
      path: [historicalManifest],
      principalPolicies: [policy],
      userId: laterMember.userId,
    }),
  ).toBeNull();
  expect(
    resolveContainerPathUserAccessLevel({
      path: [historicalManifest],
      principalPolicies: [policy],
      userId: laterMember.userId,
    }),
  ).toBe("read");
});
