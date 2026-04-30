import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { generateKemSeedAndKeyPair } from "./encapsulation/generateKeyPair";
import { toFingerprint } from "./fingerprint";
import type {
  KeyingV2VerificationCode,
  KeyingV2VerificationResult,
  PrincipalPolicyBundleV2,
  PrincipalPolicySignedStateV2,
  PrincipalPolicySignerPublicKeyV2,
  PrincipalPolicyStateChainEntryV2,
} from "./keyingV2";
import { verifyPrincipalPolicyBundle } from "./keyingV2";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  type PrincipalProjectionMember,
  type PrincipalStateMember,
  signPrincipalState,
} from "./principalState";
import { generateSigningSeedAndKeyPair } from "./signing/generateKeyPair";

function expectVerificationError<T>(
  result: KeyingV2VerificationResult<T>,
  code: KeyingV2VerificationCode,
) {
  if (result.ok) {
    throw new Error("Expected verification to fail");
  }

  expect(result.error.code).toBe(code);
}

function projectionWithAdmin(
  signerUserId: string,
  members: readonly PrincipalStateMember[],
): PrincipalProjectionMember[] {
  const projectionByMember = new Map<string, PrincipalProjectionMember>();

  projectionByMember.set(`user:${signerUserId}`, {
    memberPrincipalType: "user",
    memberPrincipalId: signerUserId,
    role: "admin",
  });

  for (const member of members) {
    const key = `${member.principalType}:${member.principalId}`;
    if (projectionByMember.has(key)) {
      continue;
    }

    projectionByMember.set(key, {
      memberPrincipalType: member.principalType,
      memberPrincipalId: member.principalId,
      role: "member",
    });
  }

  return Array.from(projectionByMember.values());
}

async function createPolicySigner(): Promise<
  ReturnType<typeof generateSigningSeedAndKeyPair> &
    PrincipalPolicySignerPublicKeyV2
> {
  const signing = generateSigningSeedAndKeyPair();
  return {
    ...signing,
    userId: "user-admin",
    signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    signingPublicKey: signing.signingPublicKey,
  };
}

async function signPolicyState(input: {
  readonly keyEpoch?: number;
  readonly members: readonly PrincipalStateMember[];
  readonly prevStateHash: string | null;
  readonly principalId: string;
  readonly principalKeyPair?: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly projection?: readonly PrincipalProjectionMember[];
  readonly signedAt?: string;
  readonly signer: Awaited<ReturnType<typeof createPolicySigner>>;
  readonly version: number;
}): Promise<{
  readonly entry: PrincipalPolicyStateChainEntryV2;
  readonly payload: PrincipalPolicyBundleV2["currentPayload"];
  readonly state: PrincipalPolicySignedStateV2;
}> {
  const principalKeyPair =
    input.principalKeyPair ?? generateKemSeedAndKeyPair();
  const projection =
    input.projection ?? projectionWithAdmin(input.signer.userId, input.members);
  const payloadCiphertext = JSON.stringify({ members: projection });
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.principalId,
      version: input.version,
      prevStateHash: input.prevStateHash,
      keyEpoch: input.keyEpoch ?? 1,
      encapsulationPublicKey: bytesToBase64(principalKeyPair.publicKey),
      keyFingerprint: await toFingerprint(principalKeyPair.publicKey),
      members: [...input.members],
      projection: [...projection],
      payloadCiphertext,
      signedAt: input.signedAt ?? `2026-04-26T12:0${input.version}:00.000Z`,
      signerUserId: input.signer.userId,
      signerUserKeyFingerprint: input.signer.signingKeyFingerprint,
    }),
    input.signer.signingPrivateKey,
  );
  const stateWithHash = {
    ...state,
    stateHash: await computePrincipalStateHash(state),
  };

  return {
    state: stateWithHash,
    entry: {
      state: stateWithHash,
      projection,
    },
    payload: {
      principalType: "group",
      principalId: input.principalId,
      stateHash: stateWithHash.stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
  };
}

function createBundle(input: {
  readonly current: Awaited<ReturnType<typeof signPolicyState>>;
  readonly previous?: readonly PrincipalPolicyStateChainEntryV2[];
}): PrincipalPolicyBundleV2 {
  return {
    currentState: input.current.state,
    currentPayload: input.current.payload,
    currentProjection: input.current.entry.projection,
    currentMemberEnvelopes: {
      principalType: input.current.state.principalType,
      principalId: input.current.state.principalId,
      stateHash: input.current.state.stateHash,
      epoch: input.current.state.keyEpoch,
    },
    previousStates: input.previous ?? [],
  };
}

test("verifyPrincipalPolicyBundle accepts additive membership without key epoch advance", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-additive";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    members: [{ principalType: "user", principalId: signer.userId }],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "user", principalId: "user-bob" },
    ],
    signer,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: second, previous: [first.entry] }),
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
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "user", principalId: "user-bob" },
    ],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ principalType: "user", principalId: signer.userId }],
    signer,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: second, previous: [first.entry] }),
    signerPublicKeys: [signer],
  });

  expectVerificationError(result, "key_epoch_reuse");
});

test("verifyPrincipalPolicyBundle rejects nested group removal without a new key epoch", async () => {
  const signer = await createPolicySigner();
  const principalId = "group-nested-shrink";
  const principalKeyPair = generateKemSeedAndKeyPair();
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "group", principalId: "nested-group" },
    ],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ principalType: "user", principalId: signer.userId }],
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
      memberPrincipalType: "user",
      memberPrincipalId: signer.userId,
      role: "admin",
    },
    {
      memberPrincipalType: "user",
      memberPrincipalId: "user-bob",
      role: "admin",
    },
  ];
  const demotedProjection: PrincipalProjectionMember[] = [
    {
      memberPrincipalType: "user",
      memberPrincipalId: signer.userId,
      role: "admin",
    },
    {
      memberPrincipalType: "user",
      memberPrincipalId: "user-bob",
      role: "member",
    },
  ];
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    projection: firstProjection,
    version: 1,
    prevStateHash: null,
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "user", principalId: "user-bob" },
    ],
    signer,
  });
  const demoted = await signPolicyState({
    principalId,
    principalKeyPair,
    projection: demotedProjection,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "user", principalId: "user-bob" },
    ],
    signer,
  });

  const demotionResult = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: demoted, previous: [first.entry] }),
    signerPublicKeys: [signer],
  });
  expectVerificationError(demotionResult, "key_epoch_reuse");

  const sameEpochKeyChange = await signPolicyState({
    principalId,
    principalKeyPair: generateKemSeedAndKeyPair(),
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "user", principalId: "user-bob" },
    ],
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
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "user", principalId: "user-bob" },
    ],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair: generateKemSeedAndKeyPair(),
    keyEpoch: 2,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [{ principalType: "user", principalId: signer.userId }],
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
    members: [{ principalType: "user", principalId: signer.userId }],
    signer,
  });
  const second = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 2,
    prevStateHash: first.state.stateHash,
    members: [
      { principalType: "user", principalId: signer.userId },
      { principalType: "user", principalId: "user-bob" },
    ],
    signer,
  });
  const alternateFirst = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    signedAt: "2026-04-26T12:59:00.000Z",
    members: [{ principalType: "user", principalId: signer.userId }],
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
    members: [{ principalType: "user", principalId: signer.userId }],
    signer,
  });

  const result = await verifyPrincipalPolicyBundle({
    bundle: createBundle({ current: state }),
    signerPublicKeys: [],
  });

  expectVerificationError(result, "missing_dependency");
});
