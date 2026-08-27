import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerGrantPrincipalHead,
  VerifiedPrincipalPolicy,
} from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  resolveContainerPathUserAccessLevel,
  resolveHistoricalContainerPathUserAccessLevel,
  verifyContainerAccessManifest,
} from "./index";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
  createVerifiedContainerAccessEvent,
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

test("historical manifest verification uses membership at the referenced policy head", async () => {
  const historicalHead: ContainerGrantPrincipalHead = {
    principalType: "group",
    principalId: "historical-verification-group",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("historical-verification-state-1"),
    keyFingerprint: await fixtureHash("historical-verification-key-1"),
  };
  const currentHead: ContainerGrantPrincipalHead = {
    ...historicalHead,
    version: 2,
    keyEpoch: 2,
    stateHash: await fixtureHash("historical-verification-state-2"),
    keyFingerprint: await fixtureHash("historical-verification-key-2"),
  };
  const formerMember = "former-admin";
  const laterMember = "later-admin";
  const currentPolicy = createPrincipalPolicyFixture(currentHead);
  const policy = {
    ...currentPolicy,
    projection: [{ role: "admin", userId: laterMember }],
    history: [
      {
        grants: [],
        projection: [{ role: "admin", userId: formerMember }],
        state: policyState(historicalHead),
      },
      {
        grants: [],
        projection: [{ role: "admin", userId: laterMember }],
        state: policyState(currentHead),
      },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  const previous = await createContainerManifestFixture({
    containerId: "historical-verification-container",
    containerKeyEpochId: "historical-verification-key-epoch",
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: historicalHead.principalId,
        subjectType: "group",
      },
    ],
    referencedPrincipalHeads: [historicalHead],
  });

  async function verifyGrant(signerUserId: string) {
    const body: ContainerAccessEventBody = {
      containerKeyEpochId: previous.state.containerKeyEpochId,
      eventType: "container.grant",
      grant: {
        accessLevel: "read",
        subjectId: `reader-${signerUserId}`,
        subjectType: "user",
      },
      referencedPrincipalHead: null,
    };
    const event = await createVerifiedContainerAccessEvent({
      body,
      objectId: previous.state.containerId,
      organizationId: previous.state.organizationId,
      previousManifestHash: previous.manifestHash,
      signer: generateSigningSeedAndKeyPair(),
      signerUserId,
    });
    const state: ContainerAccessManifestState = {
      ...previous.state,
      directGrants: [...previous.state.directGrants, body.grant],
      epoch: previous.state.epoch + 1,
      eventHash: event.eventHash,
      previousManifestHash: previous.manifestHash,
    };
    const manifest = await deriveContainerAccessManifest(state);
    const base = {
      event,
      expectedManifestHash: await computeAccessManifestHash(manifest),
      manifest,
      previousContainerPath: [previous],
      previousManifest: previous,
      principalPolicies: [policy],
    };
    return {
      current: await verifyContainerAccessManifest(base),
      historical: await verifyContainerAccessManifest({
        ...base,
        authorizationMembership: "referenced",
      }),
    };
  }

  const former = await verifyGrant(formerMember);
  expect(former.current).toMatchObject({
    error: { code: "unauthorized" },
    ok: false,
  });
  expect(former.historical.ok).toBe(true);

  const later = await verifyGrant(laterMember);
  expect(later.current.ok).toBe(true);
  expect(later.historical).toMatchObject({
    error: { code: "unauthorized" },
    ok: false,
  });
});
