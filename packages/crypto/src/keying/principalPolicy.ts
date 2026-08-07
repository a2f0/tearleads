import { toFingerprint } from "../fingerprint";
import type {
  PrincipalProjectionMember,
  SignedPrincipalState,
} from "../principalState";
import {
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  normalizePrincipalProjectionMembers,
  verifySignedPrincipalState,
} from "../principalState";
import { verifyPrincipalPolicyProjectionCommitments } from "./principalPolicyCommitments";
import {
  createPrincipalPolicyExternalAuthorityVerifier,
  externalAuthorityIncludesAdminSigner,
  type PrincipalPolicyExternalAuthorityVerifier,
  verifyPrincipalPolicyExternalAuthorityProgress,
} from "./principalPolicyExternalAuthority";
import { verifyPrincipalPolicyMemberEnvelopes } from "./principalPolicyMemberEnvelopes";
import {
  getPrincipalPolicyTransitionMismatch,
  throwPrincipalPolicyTransitionError,
} from "./principalPolicyTransition";
import { runVerifier, throwVerification } from "./shared";
import type {
  KeyingVerificationResult,
  NormalizedPrincipalPolicyStateChainEntry,
  PrincipalPolicyBundle,
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignedState,
  PrincipalPolicySignerPublicKey,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
  VerifyPrincipalPolicyBundleInput,
} from "./types";
import { makeVerifiedPrincipalPolicy } from "./types";

function projectionIncludesAdminUser(
  projection: readonly PrincipalProjectionMember[],
  userId: string,
): boolean {
  return projection.some(
    (member) => member.userId === userId && member.role === "admin",
  );
}

function normalizePrincipalPolicySignerKey(
  signerKey: PrincipalPolicySignerPublicKey,
): PrincipalPolicySignerPublicKey {
  if (signerKey.userId.length === 0) {
    throwVerification("invalid_shape", "principal policy signer user missing");
  }

  if (!/^[0-9a-f]{64}$/.test(signerKey.signingKeyFingerprint)) {
    throwVerification(
      "hash_mismatch",
      "principal policy signer fingerprint must be a 64-character lowercase hex hash",
    );
  }

  if (signerKey.signingPublicKey.length === 0) {
    throwVerification(
      "invalid_shape",
      "principal policy signer public key missing",
    );
  }

  return signerKey;
}

async function buildPrincipalPolicySignerKeyMap(
  signerPublicKeys: readonly PrincipalPolicySignerPublicKey[],
): Promise<Map<string, Uint8Array>> {
  const signerPublicKeyByUserAndFingerprint = new Map<string, Uint8Array>();

  for (const signerKey of signerPublicKeys.map(
    normalizePrincipalPolicySignerKey,
  )) {
    const computedFingerprint = await toFingerprint(signerKey.signingPublicKey);

    if (computedFingerprint !== signerKey.signingKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "principal policy signer key fingerprint does not match public key",
      );
    }

    const key = `${signerKey.userId}:${signerKey.signingKeyFingerprint}`;
    if (signerPublicKeyByUserAndFingerprint.has(key)) {
      throwVerification(
        "duplicate_entry",
        "principal policy signer key list contains a duplicate",
      );
    }

    signerPublicKeyByUserAndFingerprint.set(key, signerKey.signingPublicKey);
  }

  return signerPublicKeyByUserAndFingerprint;
}

function getPrincipalPolicySignerPublicKey(input: {
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
  readonly state: SignedPrincipalState;
}): Uint8Array {
  const signerPublicKey = input.signerPublicKeyByUserAndFingerprint.get(
    `${input.state.signerUserId}:${input.state.signerUserKeyFingerprint}`,
  );

  if (!signerPublicKey) {
    throwVerification(
      "missing_dependency",
      "principal policy signer public key is unavailable",
    );
  }

  return signerPublicKey;
}

async function normalizePrincipalPolicyStateChainEntry(
  entry: PrincipalPolicyStateChainEntry,
): Promise<NormalizedPrincipalPolicyStateChainEntry> {
  const projection = normalizePrincipalProjectionMembers(entry.projection);
  const computedStateHash = await computePrincipalStateHash(entry.state);

  if (computedStateHash !== entry.state.stateHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy state hash does not match signed state",
    );
  }

  await verifyPrincipalPolicyProjectionCommitments({
    projection,
    state: entry.state,
  });

  return {
    state: entry.state,
    projection,
  };
}

function principalPolicyStateMatchesReference(input: {
  readonly reference: ReferencedPrincipalHead;
  readonly state: PrincipalPolicySignedState;
}): boolean {
  return (
    input.reference.principalType === input.state.principalType &&
    input.reference.principalId === input.state.principalId &&
    input.reference.version === input.state.version &&
    input.reference.keyEpoch === input.state.keyEpoch &&
    input.reference.stateHash === input.state.stateHash &&
    input.reference.keyFingerprint === input.state.keyFingerprint
  );
}

function verifyPrincipalPolicyReference(input: {
  readonly chain: readonly NormalizedPrincipalPolicyStateChainEntry[];
  readonly expectedReference: ReferencedPrincipalHead | undefined;
  readonly currentState: PrincipalPolicySignedState;
}): void {
  const { currentState, expectedReference } = input;

  if (!expectedReference) {
    return;
  }

  if (
    expectedReference.principalType !== currentState.principalType ||
    expectedReference.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy bundle does not match referenced principal",
    );
  }

  const matchingEntry = input.chain.find((entry) =>
    principalPolicyStateMatchesReference({
      reference: expectedReference,
      state: entry.state,
    }),
  );

  if (!matchingEntry) {
    throwVerification(
      "hash_mismatch",
      "principal policy bundle does not match referenced principal head",
    );
  }
}

async function verifyPrincipalPolicyPayload(input: {
  readonly bundle: PrincipalPolicyBundle;
}): Promise<void> {
  const { currentPayload, currentState } = input.bundle;

  if (
    currentPayload.principalType !== currentState.principalType ||
    currentPayload.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy payload does not match current state principal",
    );
  }

  if (currentPayload.stateHash !== currentState.stateHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload state hash does not match current state",
    );
  }

  const computedPayloadHash = await computePrincipalStatePayloadCiphertextHash(
    currentPayload.ciphertext,
  );

  if (computedPayloadHash !== currentPayload.ciphertextHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload hash does not match ciphertext",
    );
  }

  if (computedPayloadHash !== currentState.payloadCiphertextHash) {
    throwVerification(
      "hash_mismatch",
      "principal policy payload hash does not match current state",
    );
  }
}

export function verifyPrincipalPolicyCheckpoint(input: {
  readonly chain: readonly NormalizedPrincipalPolicyStateChainEntry[];
  readonly currentState: PrincipalPolicySignedState;
  readonly localCheckpoint: PrincipalPolicyCheckpoint | null | undefined;
}): void {
  const { currentState, localCheckpoint } = input;

  if (!localCheckpoint) {
    return;
  }

  if (
    localCheckpoint.principalType !== currentState.principalType ||
    localCheckpoint.principalId !== currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy checkpoint does not match current principal",
    );
  }

  if (currentState.version < localCheckpoint.version) {
    throwVerification(
      "rollback",
      "principal policy state is older than the local checkpoint",
    );
  }

  if (
    currentState.version === localCheckpoint.version &&
    currentState.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "equivocation",
      "principal policy state conflicts with the local checkpoint",
    );
  }

  if (currentState.version === localCheckpoint.version) {
    return;
  }

  const checkpointEntry = input.chain[localCheckpoint.version - 1];
  if (
    !checkpointEntry ||
    checkpointEntry.state.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain does not extend the local checkpoint",
    );
  }
}

function verifyPrincipalPolicyChainShape(input: {
  readonly chainLength: number;
  readonly currentState: PrincipalPolicySignedState;
}): void {
  if (input.chainLength !== input.currentState.version) {
    throwVerification(
      "missing_dependency",
      "principal policy chain length does not match current state version",
    );
  }
}

function verifyPrincipalPolicyChainEntryIdentity(input: {
  readonly currentState: PrincipalPolicySignedState;
  readonly expectedVersion: number;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  if (
    input.normalizedEntry.state.principalType !==
      input.currentState.principalType ||
    input.normalizedEntry.state.principalId !== input.currentState.principalId
  ) {
    throwVerification(
      "object_mismatch",
      "principal policy chain entry principal does not match current state",
    );
  }

  if (input.normalizedEntry.state.version !== input.expectedVersion) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry version is not contiguous",
    );
  }
}

function verifyInitialPrincipalPolicyChainEntry(input: {
  readonly authorityVerifier: PrincipalPolicyExternalAuthorityVerifier;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  const { normalizedEntry } = input;

  if (normalizedEntry.state.prevStateHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial principal policy chain entry has a previous state hash",
    );
  }

  if (
    projectionIncludesAdminUser(
      normalizedEntry.projection,
      normalizedEntry.state.signerUserId,
    )
  ) {
    if (normalizedEntry.state.externalAuthority) {
      throwVerification(
        "invalid_shape",
        "directly authorized principal policy state cannot cite external authority",
      );
    }
    return;
  }

  if (
    normalizedEntry.projection.length === 0 &&
    externalAuthorityIncludesAdminSigner({
      entry: normalizedEntry,
      verifier: input.authorityVerifier,
    })
  ) {
    return;
  }

  throwVerification(
    "unauthorized",
    "initial principal policy state signer is not an admin",
  );
}

function verifySuccessorPrincipalPolicyChainEntry(input: {
  readonly authorityVerifier: PrincipalPolicyExternalAuthorityVerifier;
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
  readonly previousEntry: NormalizedPrincipalPolicyStateChainEntry;
}): void {
  if (
    input.normalizedEntry.state.prevStateHash !==
    input.previousEntry.state.stateHash
  ) {
    throwVerification(
      "stale_predecessor",
      "principal policy chain entry previous hash mismatch",
    );
  }

  const isDirectAdmin = projectionIncludesAdminUser(
    input.previousEntry.projection,
    input.normalizedEntry.state.signerUserId,
  );
  const isExternalAdmin = externalAuthorityIncludesAdminSigner({
    entry: input.normalizedEntry,
    verifier: input.authorityVerifier,
  });
  if (!isDirectAdmin && !isExternalAdmin) {
    throwVerification(
      "unauthorized",
      "principal policy state signer is not an admin in previous projection",
    );
  }
  if (isDirectAdmin && input.normalizedEntry.state.externalAuthority) {
    throwVerification(
      "invalid_shape",
      "directly authorized principal policy state cannot cite external authority",
    );
  }

  const transitionMismatch = getPrincipalPolicyTransitionMismatch({
    current: input.normalizedEntry,
    previous: input.previousEntry,
  });

  if (transitionMismatch) {
    throwPrincipalPolicyTransitionError(transitionMismatch);
  }
}

async function verifyPrincipalPolicyChainEntrySignature(input: {
  readonly normalizedEntry: NormalizedPrincipalPolicyStateChainEntry;
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<void> {
  const signerPublicKey = getPrincipalPolicySignerPublicKey({
    signerPublicKeyByUserAndFingerprint:
      input.signerPublicKeyByUserAndFingerprint,
    state: input.normalizedEntry.state,
  });

  if (
    !(await verifySignedPrincipalState(
      input.normalizedEntry.state,
      signerPublicKey,
    ))
  ) {
    throwVerification(
      "signature_mismatch",
      "principal policy state signature verification failed",
    );
  }
}

async function verifyPrincipalPolicyChain(input: {
  readonly bundle: PrincipalPolicyBundle;
  readonly externalAuthority: VerifyPrincipalPolicyBundleInput["externalAuthority"];
  readonly localCheckpoint: PrincipalPolicyCheckpoint | null | undefined;
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<NormalizedPrincipalPolicyStateChainEntry[]> {
  const chain = [
    ...input.bundle.previousStates,
    {
      state: input.bundle.currentState,
      projection: input.bundle.currentProjection,
    },
  ];

  verifyPrincipalPolicyChainShape({
    chainLength: chain.length,
    currentState: input.bundle.currentState,
  });

  const normalizedChain: NormalizedPrincipalPolicyStateChainEntry[] = [];
  const authorityVerifier = createPrincipalPolicyExternalAuthorityVerifier({
    authority: input.externalAuthority,
    localCheckpoint: input.localCheckpoint,
  });

  for (let index = 0; index < chain.length; index += 1) {
    const entry = chain[index];
    if (!entry) {
      throwVerification(
        "missing_dependency",
        "principal policy chain entry is missing",
      );
    }

    const normalizedEntry =
      await normalizePrincipalPolicyStateChainEntry(entry);

    verifyPrincipalPolicyChainEntryIdentity({
      currentState: input.bundle.currentState,
      expectedVersion: index + 1,
      normalizedEntry,
    });

    const previousEntry = normalizedChain[index - 1];
    if (previousEntry) {
      verifySuccessorPrincipalPolicyChainEntry({
        authorityVerifier,
        normalizedEntry,
        previousEntry,
      });
    } else {
      verifyInitialPrincipalPolicyChainEntry({
        authorityVerifier,
        normalizedEntry,
      });
    }

    verifyPrincipalPolicyExternalAuthorityProgress({
      entry: normalizedEntry,
      verifier: authorityVerifier,
    });

    await verifyPrincipalPolicyChainEntrySignature({
      normalizedEntry,
      signerPublicKeyByUserAndFingerprint:
        input.signerPublicKeyByUserAndFingerprint,
    });

    normalizedChain.push(normalizedEntry);
  }

  return normalizedChain;
}

export async function verifyPrincipalPolicyBundle({
  bundle,
  externalAuthority,
  expectedReference,
  localCheckpoint,
  signerPublicKeys,
}: VerifyPrincipalPolicyBundleInput): Promise<
  KeyingVerificationResult<VerifiedPrincipalPolicy>
> {
  return runVerifier(async () => {
    const signerPublicKeyByUserAndFingerprint =
      await buildPrincipalPolicySignerKeyMap(signerPublicKeys);
    const normalizedChain = await verifyPrincipalPolicyChain({
      bundle,
      externalAuthority,
      localCheckpoint,
      signerPublicKeyByUserAndFingerprint,
    });
    const currentEntry = normalizedChain.at(-1);

    if (!currentEntry) {
      throwVerification(
        "missing_dependency",
        "principal policy chain is empty",
      );
    }

    await verifyPrincipalPolicyPayload({ bundle });
    await verifyPrincipalPolicyMemberEnvelopes({ bundle });
    verifyPrincipalPolicyReference({
      chain: normalizedChain,
      currentState: currentEntry.state,
      expectedReference,
    });
    verifyPrincipalPolicyCheckpoint({
      chain: normalizedChain,
      currentState: currentEntry.state,
      localCheckpoint,
    });

    return makeVerifiedPrincipalPolicy({
      principalType: currentEntry.state.principalType,
      principalId: currentEntry.state.principalId,
      version: currentEntry.state.version,
      keyEpoch: currentEntry.state.keyEpoch,
      stateHash: currentEntry.state.stateHash,
      state: currentEntry.state,
      projection: currentEntry.projection,
      history: normalizedChain,
      checkpoint: {
        principalType: currentEntry.state.principalType,
        principalId: currentEntry.state.principalId,
        version: currentEntry.state.version,
        stateHash: currentEntry.state.stateHash,
      },
    });
  });
}
