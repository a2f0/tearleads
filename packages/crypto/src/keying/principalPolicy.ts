import { computePrincipalStatePayloadCiphertextHash } from "../principalState";
import {
  normalizePrincipalPolicyStateChainEntry,
  verifyInitialPrincipalPolicyChainEntry,
  verifyPrincipalPolicyChainEntryIdentity,
  verifySuccessorPrincipalPolicyChainEntry,
} from "./principalPolicyChainEntry";
import {
  createPrincipalPolicyExternalAuthorityVerifier,
  verifyPrincipalPolicyExternalAuthorityProgress,
} from "./principalPolicyExternalAuthority";
import { verifyPrincipalPolicyMemberEnvelopes } from "./principalPolicyMemberEnvelopes";
import { verifyPrincipalPolicyChainSignatures } from "./principalPolicySignatures";
import { buildPrincipalPolicySignerKeyMap } from "./principalPolicySignerKeys";
import { runVerifier, throwVerification } from "./shared";
import type {
  KeyingVerificationResult,
  NormalizedPrincipalPolicyStateChainEntry,
  PrincipalPolicyBundle,
  PrincipalPolicyCheckpoint,
  PrincipalPolicySignedState,
  PrincipalPolicySignerPublicKey,
  PrincipalPolicySnapshot,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
  VerifiedPrincipalPolicySnapshot,
  VerifyPrincipalPolicyBundleInput,
  VerifyPrincipalPolicySnapshotInput,
} from "./types";
import {
  makeVerifiedPrincipalPolicy,
  makeVerifiedPrincipalPolicySnapshot,
} from "./types";

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

async function verifyPrincipalPolicyChain(input: {
  readonly bundle: PrincipalPolicySnapshot;
  readonly externalAuthority: VerifyPrincipalPolicyBundleInput["externalAuthority"];
  readonly signerPublicKeyByUserAndFingerprint: ReadonlyMap<string, Uint8Array>;
}): Promise<NormalizedPrincipalPolicyStateChainEntry[]> {
  const chain = [
    ...input.bundle.previousStates,
    {
      state: input.bundle.currentState,
      projection: input.bundle.currentProjection,
      grants: input.bundle.currentGrants,
    },
  ];

  verifyPrincipalPolicyChainShape({
    chainLength: chain.length,
    currentState: input.bundle.currentState,
  });

  const normalizedChain: NormalizedPrincipalPolicyStateChainEntry[] = [];
  const authorityVerifier = createPrincipalPolicyExternalAuthorityVerifier({
    authority: input.externalAuthority,
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

    normalizedChain.push(normalizedEntry);
  }

  await verifyPrincipalPolicyChainSignatures({
    chain: normalizedChain,
    signerPublicKeyByUserAndFingerprint:
      input.signerPublicKeyByUserAndFingerprint,
  });
  return normalizedChain;
}

async function verifyPrincipalPolicyAuthorizationEvidence(input: {
  readonly bundle: PrincipalPolicySnapshot;
  readonly externalAuthority: VerifyPrincipalPolicyBundleInput["externalAuthority"];
  readonly expectedReference: ReferencedPrincipalHead | undefined;
  readonly localCheckpoint: PrincipalPolicyCheckpoint | null | undefined;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
}): Promise<{
  readonly currentEntry: NormalizedPrincipalPolicyStateChainEntry;
  readonly normalizedChain: NormalizedPrincipalPolicyStateChainEntry[];
}> {
  const signerPublicKeyByUserAndFingerprint =
    await buildPrincipalPolicySignerKeyMap(input.signerPublicKeys);
  const normalizedChain = await verifyPrincipalPolicyChain({
    bundle: input.bundle,
    externalAuthority: input.externalAuthority,
    signerPublicKeyByUserAndFingerprint,
  });
  const currentEntry = normalizedChain.at(-1);
  if (!currentEntry) {
    throwVerification("missing_dependency", "principal policy chain is empty");
  }
  verifyPrincipalPolicyReference({
    chain: normalizedChain,
    currentState: currentEntry.state,
    expectedReference: input.expectedReference,
  });
  verifyPrincipalPolicyCheckpoint({
    chain: normalizedChain,
    currentState: currentEntry.state,
    localCheckpoint: input.localCheckpoint,
  });
  return { currentEntry, normalizedChain };
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
    const { currentEntry, normalizedChain } =
      await verifyPrincipalPolicyAuthorizationEvidence({
        bundle,
        externalAuthority,
        expectedReference,
        localCheckpoint,
        signerPublicKeys,
      });

    await verifyPrincipalPolicyPayload({ bundle });
    await verifyPrincipalPolicyMemberEnvelopes({ bundle });

    return makeVerifiedPrincipalPolicy({
      principalType: currentEntry.state.principalType,
      principalId: currentEntry.state.principalId,
      version: currentEntry.state.version,
      keyEpoch: currentEntry.state.keyEpoch,
      stateHash: currentEntry.state.stateHash,
      state: currentEntry.state,
      projection: currentEntry.projection,
      grants: currentEntry.grants,
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

export async function verifyPrincipalPolicySnapshot({
  snapshot,
  externalAuthority,
  expectedReference,
  signerPublicKeys,
}: VerifyPrincipalPolicySnapshotInput): Promise<
  KeyingVerificationResult<VerifiedPrincipalPolicySnapshot>
> {
  return runVerifier(async () => {
    const { currentEntry, normalizedChain } =
      await verifyPrincipalPolicyAuthorizationEvidence({
        bundle: snapshot,
        externalAuthority,
        expectedReference,
        localCheckpoint: null,
        signerPublicKeys,
      });
    return makeVerifiedPrincipalPolicySnapshot({
      principalType: currentEntry.state.principalType,
      principalId: currentEntry.state.principalId,
      version: currentEntry.state.version,
      keyEpoch: currentEntry.state.keyEpoch,
      stateHash: currentEntry.state.stateHash,
      state: currentEntry.state,
      projection: currentEntry.projection,
      grants: currentEntry.grants,
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
