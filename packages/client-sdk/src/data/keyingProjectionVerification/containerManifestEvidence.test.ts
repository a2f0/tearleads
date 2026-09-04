import { expect, test } from "bun:test";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerGrantPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  verifyContainerAccessManifest,
} from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "@tearleads/crypto/test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import { manifestBundle } from "../../../test/helpers/ancestorCitationScenario";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "./principalPolicyCache";

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

test("required purge evidence reaches every recursive container predecessor", async () => {
  const historicalHead: ContainerGrantPrincipalHead = {
    principalType: "group",
    principalId: "recursive-evidence-group",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("recursive-evidence-group-state-1"),
    keyFingerprint: await fixtureHash("recursive-evidence-group-key-1"),
  };
  const currentHead: ContainerGrantPrincipalHead = {
    ...historicalHead,
    version: 2,
    keyEpoch: 2,
    stateHash: await fixtureHash("recursive-evidence-group-state-2"),
    keyFingerprint: await fixtureHash("recursive-evidence-group-key-2"),
  };
  const signerUserId = "recursive-evidence-admin";
  const signing = generateSigningSeedAndKeyPair();
  const currentPolicy = createPrincipalPolicyFixture(currentHead);
  const policy = {
    ...currentPolicy,
    projection: [],
    history: [
      {
        grants: [],
        projection: [{ role: "member", userId: "historical-member" }],
        state: policyState(historicalHead),
      },
      {
        grants: [],
        projection: [],
        state: policyState(currentHead),
      },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  const initial = await createContainerManifestFixture({
    containerId: "recursive-evidence-container",
    containerKeyEpochId: "recursive-evidence-key-1",
    directGrants: [
      {
        accessLevel: "read",
        subjectId: historicalHead.principalId,
        subjectType: "group",
      },
      {
        accessLevel: "admin",
        subjectId: signerUserId,
        subjectType: "user",
      },
    ],
    referencedPrincipalHeads: [historicalHead],
    signer: signing,
    signerUserId,
  });
  const revokeBody: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId: "recursive-evidence-key-2",
    keyringHash: await fixtureHash("recursive-evidence-keyring"),
    predecessorBridgeHash: await fixtureHash(
      "recursive-evidence-predecessor-bridge",
    ),
    subjectId: historicalHead.principalId,
    subjectType: "group",
  };
  const revokeEvent = await createVerifiedContainerAccessEvent({
    body: revokeBody,
    objectId: initial.state.containerId,
    organizationId: initial.state.organizationId,
    previousManifestHash: initial.manifestHash,
    signer: signing,
    signerUserId,
  });
  const revokedState: ContainerAccessManifestState = {
    ...initial.state,
    containerKeyEpochId: revokeBody.containerKeyEpochId,
    directGrants: initial.state.directGrants.filter(
      (grant) => grant.subjectType !== "group",
    ),
    epoch: initial.state.epoch + 1,
    eventHash: revokeEvent.eventHash,
    previousManifestHash: initial.manifestHash,
    referencedPrincipalHeads: [],
  };
  const revokedManifest = await deriveContainerAccessManifest(revokedState);
  const revoked = {
    event: revokeEvent,
    manifest: revokedManifest,
    manifestHash: await computeAccessManifestHash(revokedManifest),
    state: revokedState,
  } as VerifiedContainerAccessManifest;
  const revokedVerification = await verifyContainerAccessManifest({
    authorizationMembership: "referenced",
    event: revokeEvent,
    expectedManifestHash: revoked.manifestHash,
    manifest: revoked.manifest,
    previousContainerPath: [initial],
    previousManifest: initial,
    principalPolicies: [policy],
  });
  expect(revokedVerification.ok).toBe(true);
  if (!revokedVerification.ok) throw revokedVerification.error;
  expect(revoked.state).toEqual(revokedVerification.value.state);
  const grantBody: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: revoked.state.containerKeyEpochId,
    grant: {
      accessLevel: "read",
      subjectId: "recursive-evidence-reader",
      subjectType: "user",
    },
    referencedPrincipalHead: null,
  };
  const grantEvent = await createVerifiedContainerAccessEvent({
    body: grantBody,
    objectId: revoked.state.containerId,
    organizationId: revoked.state.organizationId,
    previousManifestHash: revoked.manifestHash,
    signer: signing,
    signerUserId,
  });
  const grantedState: ContainerAccessManifestState = {
    ...revoked.state,
    directGrants: [...revoked.state.directGrants, grantBody.grant],
    epoch: revoked.state.epoch + 1,
    eventHash: grantEvent.eventHash,
    previousManifestHash: revoked.manifestHash,
  };
  const grantedManifest = await deriveContainerAccessManifest(grantedState);
  const granted = {
    event: grantEvent,
    manifest: grantedManifest,
    manifestHash: await computeAccessManifestHash(grantedManifest),
    state: grantedState,
  } as VerifiedContainerAccessManifest;
  const bundles = [initial, revoked, granted].map(manifestBundle);
  const bundlesByHash = new Map(
    bundles.map((bundle) => [bundle.manifestHash, bundle]),
  );
  const signingKeyFingerprint = await toFingerprint(signing.signingPublicKey);
  const resolveUserKey = async (userId: string) =>
    userId === signerUserId
      ? createTestTrustedUserIdentity({
          signingKeyFingerprint,
          signingPublicKey: signing.signingPublicKey,
          userId,
        })
      : null;
  const { close, execSql } = await createTestExecSql(
    "recursive-container-evidence",
  );

  try {
    const warmPath = await verifyContainerManifestPath({
      authorizationMembership: "referenced",
      bundlesByHash,
      checkpointContext: createProjectionCheckpointContext({ execSql }),
      enforceLocalCheckpoints: false,
      label: "Warm cached container path",
      path: [manifestBundle(granted)],
      principalPolicyCache: principalPolicyCacheForVerifiedPolicies([policy]),
      resolveUserKey,
      verifiedByHash: new Map(),
    });
    expect(warmPath).toHaveLength(1);

    await expect(
      verifyContainerManifestPath({
        authorizationEvidence: [],
        authorizationMembership: "referenced",
        bundlesByHash,
        checkpointContext: createProjectionCheckpointContext({ execSql }),
        enforceLocalCheckpoints: false,
        label: "Cold purge container path",
        path: [manifestBundle(granted)],
        principalPolicyCache: principalPolicyCacheForVerifiedPolicies([policy]),
        requireAuthorizationEvidence: true,
        resolveUserKey,
        verifiedByHash: new Map(),
      }),
    ).rejects.toMatchObject({
      code: "missing_dependency",
      message: "Projection omits required principal policy evidence",
    });
  } finally {
    close();
  }
});
