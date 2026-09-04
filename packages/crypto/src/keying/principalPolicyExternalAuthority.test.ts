import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import type { PrincipalProjectionMember } from "../principalState";
import { verifyPrincipalPolicyBundle } from "./index";
import {
  createBundle,
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

test("verifyPrincipalPolicyBundle accepts external admin signers for successors and empty initial policies", async () => {
  const principalAdmin = await createPolicySigner("principal-admin");
  const externalAdmin = await createPolicySigner("org-admin");
  const adminPolicy = await signPolicyState({
    principalId: "admins-group",
    version: 1,
    prevStateHash: null,
    members: [{ userId: externalAdmin.userId }],
    signer: externalAdmin,
  });
  const adminHead = {
    principalType: "group" as const,
    principalId: adminPolicy.state.principalId,
    version: adminPolicy.state.version,
    keyEpoch: adminPolicy.state.keyEpoch,
    stateHash: adminPolicy.state.stateHash,
    keyFingerprint: adminPolicy.state.keyFingerprint,
  };
  const externalAuthority = {
    currentHead: adminHead,
    states: [{ head: adminHead, projection: adminPolicy.entry.projection }],
  };
  const principalId = "group-external-admin";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    members: [{ userId: principalAdmin.userId }],
    signer: principalAdmin,
  });
  const secondProjection: PrincipalProjectionMember[] = [
    ...first.entry.projection,
    {
      userId: externalAdmin.userId,
      role: "member",
    },
  ];
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: secondProjection.map((member) => ({ userId: member.userId })),
    projection: secondProjection,
    externalAuthority: adminHead,
    signer: externalAdmin,
  });

  const successorResult = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: second, previous: [first.entry] }),
    externalAuthority,
    localCheckpoint: {
      principalType: "group",
      principalId,
      version: first.state.version,
      stateHash: first.state.stateHash,
    },
    signerPublicKeys: [principalAdmin, externalAdmin],
  });

  expect(successorResult.ok).toBe(true);

  const emptyInitial = await signPolicyState({
    principalId: "group-empty-external-initial",
    version: 1,
    prevStateHash: null,
    members: [],
    projection: [],
    externalAuthority: adminHead,
    signer: externalAdmin,
  });
  const emptyInitialResult = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: emptyInitial }),
    externalAuthority,
    signerPublicKeys: [externalAdmin],
  });

  expect(emptyInitialResult.ok).toBe(true);

  const invalidInitial = await signPolicyState({
    principalId: "group-external-initial",
    version: 1,
    prevStateHash: null,
    members: [{ userId: principalAdmin.userId }],
    projection: [
      {
        userId: principalAdmin.userId,
        role: "admin",
      },
    ],
    externalAuthority: adminHead,
    signer: externalAdmin,
  });
  const initialResult = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: invalidInitial }),
    externalAuthority,
    signerPublicKeys: [principalAdmin, externalAdmin],
  });

  expectVerificationError(initialResult, "unauthorized");
});

test("verifyPrincipalPolicyBundle accepts late successors without regressing cited authority", async () => {
  const removedAdmin = await createPolicySigner("removed-admin");
  const replacementAdmin = await createPolicySigner("replacement-admin");
  const childAdmin = await createPolicySigner("child-admin");
  const adminV1 = await signPolicyState({
    principalId: "admins-removal",
    version: 1,
    prevStateHash: null,
    members: [{ userId: removedAdmin.userId }],
    signer: removedAdmin,
  });
  const adminV2 = await signPolicyState({
    principalId: adminV1.state.principalId,
    version: 2,
    prevStateHash: adminV1.state.stateHash,
    keyEpoch: 2,
    members: [{ userId: replacementAdmin.userId }],
    projection: [
      {
        userId: replacementAdmin.userId,
        role: "admin",
      },
    ],
    signer: removedAdmin,
  });
  const toHead = (state: typeof adminV1.state) => ({
    principalType: "group" as const,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  });
  const adminV1Head = toHead(adminV1.state);
  const adminV2Head = toHead(adminV2.state);
  const verifiedAdmins = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: adminV2, previous: [adminV1.entry] }),
    signerPublicKeys: [removedAdmin, replacementAdmin],
  });
  if (!verifiedAdmins.ok) {
    throw verifiedAdmins.error;
  }
  expect(verifiedAdmins.ok).toBe(true);
  const childV1 = await signPolicyState({
    principalId: "externally-managed-child",
    version: 1,
    prevStateHash: null,
    members: [{ userId: childAdmin.userId }],
    signer: childAdmin,
  });
  const childV2 = await signPolicyState({
    principalId: childV1.state.principalId,
    version: 2,
    prevStateHash: childV1.state.stateHash,
    keyEpoch: 2,
    members: childV1.entry.projection.map((member) => ({
      userId: member.userId,
    })),
    projection: childV1.entry.projection,
    externalAuthority: adminV1Head,
    signer: removedAdmin,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({
      current: childV2,
      previous: [childV1.entry],
    }),
    externalAuthority: {
      currentHead: adminV2Head,
      states: (verifiedAdmins.value.history ?? []).map((entry) => ({
        head: toHead(entry.state),
        projection: entry.projection,
      })),
    },
    localCheckpoint: {
      principalType: "group",
      principalId: childV1.state.principalId,
      version: 1,
      stateHash: childV1.state.stateHash,
    },
    signerPublicKeys: [childAdmin, removedAdmin],
  });

  expect(result.ok).toBe(true);

  const childV3 = await signPolicyState({
    principalId: childV1.state.principalId,
    version: 3,
    prevStateHash: childV2.state.stateHash,
    keyEpoch: 3,
    members: childV1.entry.projection,
    projection: childV1.entry.projection,
    externalAuthority: adminV2Head,
    signer: replacementAdmin,
  });
  const verificationInput = {
    externalAuthority: {
      currentHead: adminV2Head,
      states: (verifiedAdmins.value.history ?? []).map((entry) => ({
        head: toHead(entry.state),
        projection: entry.projection,
      })),
    },
    localCheckpoint: {
      principalType: "group" as const,
      principalId: childV1.state.principalId,
      version: 1,
      stateHash: childV1.state.stateHash,
    },
    signerPublicKeys: [childAdmin, removedAdmin, replacementAdmin],
  };
  const advanced = await verifyPrincipalPolicyBundle({
    ...verificationInput,
    bundle: createBundle({
      current: childV3,
      previous: [childV1.entry, childV2.entry],
    }),
  });
  expect(advanced.ok).toBe(true);

  const regressed = await signPolicyState({
    principalId: childV1.state.principalId,
    version: 4,
    prevStateHash: childV3.state.stateHash,
    keyEpoch: 4,
    members: childV1.entry.projection,
    projection: childV1.entry.projection,
    externalAuthority: adminV1Head,
    signer: removedAdmin,
  });
  const rollback = await verifyPrincipalPolicyBundle({
    ...verificationInput,
    bundle: createBundle({
      current: regressed,
      previous: [childV1.entry, childV2.entry, childV3.entry],
    }),
  });
  expectVerificationError(rollback, "rollback");
  if (!rollback.ok) {
    expect(rollback.error.message).toContain(
      "principal policy external authority head rolled back",
    );
  }
});
