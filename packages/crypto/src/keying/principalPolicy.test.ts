import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import type { PrincipalProjectionMember } from "../principalState";
import {
  getPrincipalPolicyTransitionMismatch,
  verifyPrincipalPolicyBundle,
} from "./index";
import {
  createBundle,
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

test("verifyPrincipalPolicyBundle accepts additive membership without key epoch advance", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-additive";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ userId: signer.userId }, { userId: "user-bob" }],
    signer,
  });

  const bundle = createBundle({ current: second, previous: [first.entry] });
  const result = await verifyPrincipalPolicyBundle({
    bundle,
    expectedReference: {
      principalType: "group",
      principalId,
      version: second.state.version,
      keyEpoch: second.state.keyEpoch,
      stateHash: second.state.stateHash,
      keyFingerprint: second.state.keyFingerprint,
    },
    localCheckpoint: {
      principalType: "group",
      principalId,
      version: 1,
      stateHash: first.state.stateHash,
    },
    signerPublicKeys: [signer],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.checkpoint).toEqual({
      principalType: "group",
      principalId,
      version: 2,
      stateHash: second.state.stateHash,
    });
  }

  const previousReferenceResult = await verifyPrincipalPolicyBundle({
    bundle,
    expectedReference: {
      principalType: "group",
      principalId,
      version: first.state.version,
      keyEpoch: first.state.keyEpoch,
      stateHash: first.state.stateHash,
      keyFingerprint: first.state.keyFingerprint,
    },
    localCheckpoint: {
      principalType: "group",
      principalId,
      version: 1,
      stateHash: first.state.stateHash,
    },
    signerPublicKeys: [signer],
  });

  expect(previousReferenceResult.ok).toBe(true);
  if (previousReferenceResult.ok) {
    expect(previousReferenceResult.value.version).toBe(2);
    expect(previousReferenceResult.value.history).toHaveLength(2);
    expect(
      previousReferenceResult.value.projection.some(
        (member) => member.userId === "user-bob",
      ),
    ).toBe(true);
  }
});

test("verifyPrincipalPolicyBundle rejects direct member removal without a new key epoch", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-direct-shrink";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }, { userId: "user-bob" }],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ userId: signer.userId }],
    signer,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: second, previous: [first.entry] }),
    signerPublicKeys: [signer],
  });

  expectVerificationError(result, "key_epoch_reuse");
});

test("verifyPrincipalPolicyBundle rejects role demotion and same-epoch key changes", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-role-shrink";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const firstProjection: PrincipalProjectionMember[] = [
    {
      userId: signer.userId,
      role: "admin",
    },
    {
      userId: "user-bob",
      role: "admin",
    },
  ];
  const demotedProjection: PrincipalProjectionMember[] = [
    {
      userId: signer.userId,
      role: "admin",
    },
    {
      userId: "user-bob",
      role: "member",
    },
  ];
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    projection: firstProjection,
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }, { userId: "user-bob" }],
    signer,
  });
  const demoted = await signPolicyState({
    principalId,
    principalKeyPair,
    projection: demotedProjection,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ userId: signer.userId }, { userId: "user-bob" }],
    signer,
  });

  const demotionResult = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: demoted, previous: [first.entry] }),
    signerPublicKeys: [signer],
  });
  expectVerificationError(demotionResult, "key_epoch_reuse");
  expect(
    getPrincipalPolicyTransitionMismatch({
      current: demoted.entry,
      previous: first.entry,
    }),
  ).toEqual({
    code: "shrink_without_key_rotation",
    message:
      "Principal policy shrink requires a new key epoch and key material",
  });

  const sameEpochKeyChange = await signPolicyState({
    principalId,
    principalKeyPair: generateKemSeedAndKeyPair(),
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ userId: signer.userId }, { userId: "user-bob" }],
    signer,
  });
  const keyChangeResult = await verifyPrincipalPolicyBundle({
    bundle: createBundle({
      current: sameEpochKeyChange,
      previous: [first.entry],
    }),
    signerPublicKeys: [signer],
  });
  expectVerificationError(keyChangeResult, "key_epoch_reuse");
});

test("verifyPrincipalPolicyBundle accepts shrink with a rotated key epoch", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-rotated-shrink";
  const first = await signPolicyState({
    principalId,
    principalKeyPair: generateKemSeedAndKeyPair(),
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }, { userId: "user-bob" }],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair: generateKemSeedAndKeyPair(),
    keyEpoch: 2,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ userId: signer.userId }],
    signer,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: second, previous: [first.entry] }),
    signerPublicKeys: [signer],
  });

  expect(result.ok).toBe(true);
});

test("verifyPrincipalPolicyBundle rejects rollback and equivocation against local checkpoints", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-checkpoints";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ userId: signer.userId }, { userId: "user-bob" }],
    signer,
  });
  const alternateFirst = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    signedAt: "2026-04-26T12:59:00.000Z",
    members: [{ userId: signer.userId }],
    signer,
  });

  const rollback = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: first }),
    localCheckpoint: {
      principalType: "group",
      principalId,
      version: 2,
      stateHash: second.state.stateHash,
    },
    signerPublicKeys: [signer],
  });
  expectVerificationError(rollback, "rollback");

  const equivocation = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: alternateFirst }),
    localCheckpoint: {
      principalType: "group",
      principalId,
      version: 1,
      stateHash: first.state.stateHash,
    },
    signerPublicKeys: [signer],
  });
  expectVerificationError(equivocation, "equivocation");
});

test("verifyPrincipalPolicyBundle fails closed when signer keys are unavailable", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-missing-signer";
  const state = await signPolicyState({
    principalId,
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    signer,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: state }),
    signerPublicKeys: [],
  });

  expectVerificationError(result, "missing_dependency");
});

test("verifyPrincipalPolicyBundle rejects membership roots that do not match the projection", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-membership-root-mismatch";
  const state = await signPolicyState({
    principalId,
    version: 1,
    prevStateHash: null,
    members: [{ userId: signer.userId }],
    projection: [
      {
        userId: signer.userId,
        role: "admin",
      },
      {
        userId: "user-hidden-from-membership-root",
        role: "member",
      },
    ],
    signer,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: state }),
    signerPublicKeys: [signer],
  });

  expectVerificationError(result, "hash_mismatch");
});
