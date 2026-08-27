import {
  assertExactKeys,
  normalizeAccessObjectKind,
  readHashString,
  readNullableHashString,
  readPositiveInteger,
  readString,
  runVerifier,
  throwVerification,
} from "./shared";
import type {
  AccessManifest,
  AccessManifestCheckpoint,
  IdentityStateCheckpoint,
  IdentityStateHead,
  KeyingVerificationResult,
  VerifiedIdentityState,
  VerifyIdentityStateCheckpointInput,
} from "./types";
import { makeVerifiedIdentityState } from "./types";

export interface VerifiedAccessManifestCheckpointEvidence {
  readonly checkpoint: AccessManifestCheckpoint;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
}

export function normalizeIdentityStateHead(value: unknown): IdentityStateHead {
  const record = assertExactKeys(
    value,
    ["identityId", "previousStateHash", "stateHash", "version"],
    "identity state head",
  );

  return {
    identityId: readString(record, "identityId", "identity state head"),
    version: readPositiveInteger(record, "version", "identity state head"),
    stateHash: readHashString(record, "stateHash", "identity state head"),
    previousStateHash: readNullableHashString(
      record,
      "previousStateHash",
      "identity state head",
    ),
  };
}

function normalizeIdentityStateCheckpoint(
  value: unknown,
): IdentityStateCheckpoint {
  const record = assertExactKeys(
    value,
    ["identityId", "stateHash", "version"],
    "identity state checkpoint",
  );

  return {
    identityId: readString(record, "identityId", "identity state checkpoint"),
    version: readPositiveInteger(
      record,
      "version",
      "identity state checkpoint",
    ),
    stateHash: readHashString(record, "stateHash", "identity state checkpoint"),
  };
}

function identityStateCheckpointFromHead(
  head: IdentityStateHead,
): IdentityStateCheckpoint {
  return {
    identityId: head.identityId,
    version: head.version,
    stateHash: head.stateHash,
  };
}

function verifyIdentityStateCheckpointChain(input: {
  readonly head: IdentityStateHead;
  readonly localCheckpoint: IdentityStateCheckpoint | null | undefined;
  readonly checkpointPredecessors: readonly IdentityStateHead[] | undefined;
}): void {
  const { head, localCheckpoint } = input;

  if (!localCheckpoint) {
    return;
  }

  if (head.identityId !== localCheckpoint.identityId) {
    throwVerification(
      "object_mismatch",
      "identity state checkpoint does not match current identity",
    );
  }

  if (head.version < localCheckpoint.version) {
    throwVerification(
      "rollback",
      "identity state head is older than the local checkpoint",
    );
  }

  if (
    head.version === localCheckpoint.version &&
    head.stateHash !== localCheckpoint.stateHash
  ) {
    throwVerification(
      "equivocation",
      "identity state head conflicts with the local checkpoint",
    );
  }

  if (head.version === localCheckpoint.version) {
    return;
  }

  let expectedVersion = localCheckpoint.version + 1;
  let expectedPreviousHash = localCheckpoint.stateHash;
  const chain = [
    ...(input.checkpointPredecessors ?? []).map(normalizeIdentityStateHead),
    head,
  ];

  for (const chainHead of chain) {
    if (chainHead.identityId !== localCheckpoint.identityId) {
      throwVerification(
        "object_mismatch",
        "identity state checkpoint predecessor identity mismatch",
      );
    }

    if (
      chainHead.version !== expectedVersion ||
      chainHead.previousStateHash !== expectedPreviousHash
    ) {
      throwVerification(
        "stale_predecessor",
        "identity state chain does not extend the local checkpoint",
      );
    }

    expectedVersion += 1;
    expectedPreviousHash = chainHead.stateHash;
  }
}

export async function verifyIdentityStateCheckpoint({
  checkpointPredecessors,
  head,
  localCheckpoint,
}: VerifyIdentityStateCheckpointInput): Promise<
  KeyingVerificationResult<VerifiedIdentityState>
> {
  return runVerifier(async () => {
    const normalizedHead = normalizeIdentityStateHead(head);
    verifyIdentityStateCheckpointChain({
      head: normalizedHead,
      localCheckpoint: localCheckpoint
        ? normalizeIdentityStateCheckpoint(localCheckpoint)
        : null,
      checkpointPredecessors,
    });

    return makeVerifiedIdentityState({
      identityId: normalizedHead.identityId,
      version: normalizedHead.version,
      stateHash: normalizedHead.stateHash,
      head: normalizedHead,
      checkpoint: identityStateCheckpointFromHead(normalizedHead),
    });
  });
}

function normalizeAccessManifestCheckpoint(
  value: unknown,
): AccessManifestCheckpoint {
  const record = assertExactKeys(
    value,
    ["epoch", "manifestHash", "objectId", "objectKind", "organizationId"],
    "access manifest checkpoint",
  );

  return {
    objectKind: normalizeAccessObjectKind(
      record.objectKind,
      "access manifest checkpoint",
    ),
    objectId: readString(record, "objectId", "access manifest checkpoint"),
    organizationId: readString(
      record,
      "organizationId",
      "access manifest checkpoint",
    ),
    epoch: readPositiveInteger(record, "epoch", "access manifest checkpoint"),
    manifestHash: readHashString(
      record,
      "manifestHash",
      "access manifest checkpoint",
    ),
  };
}

export function accessManifestCheckpointFromManifest(input: {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
}): AccessManifestCheckpoint {
  return {
    objectKind: input.manifest.objectKind,
    objectId: input.manifest.objectId,
    organizationId: input.manifest.organizationId,
    epoch: input.manifest.epoch,
    manifestHash: input.manifestHash,
  };
}

function accessManifestCheckpointObjectMatches(
  left: AccessManifestCheckpoint,
  right: AccessManifestCheckpoint,
): boolean {
  return (
    left.objectKind === right.objectKind &&
    left.objectId === right.objectId &&
    left.organizationId === right.organizationId
  );
}

function verifiedAccessManifestCheckpointLink(
  manifest: VerifiedAccessManifestCheckpointEvidence,
): AccessManifestCheckpoint & {
  readonly previousManifestHash: string | null;
} {
  return {
    ...manifest.checkpoint,
    previousManifestHash: manifest.manifest.previousManifestHash,
  };
}

export function verifyAccessManifestLocalCheckpoint(input: {
  readonly current: AccessManifestCheckpoint & {
    readonly previousManifestHash: string | null;
  };
  readonly localCheckpoint: AccessManifestCheckpoint | null | undefined;
  readonly checkpointPredecessors:
    | readonly VerifiedAccessManifestCheckpointEvidence[]
    | undefined;
}): void {
  const { current, localCheckpoint } = input;

  if (!localCheckpoint) {
    return;
  }

  const normalizedCheckpoint =
    normalizeAccessManifestCheckpoint(localCheckpoint);

  if (!accessManifestCheckpointObjectMatches(current, normalizedCheckpoint)) {
    throwVerification(
      "object_mismatch",
      "access manifest checkpoint does not match current object",
    );
  }

  if (current.epoch < normalizedCheckpoint.epoch) {
    throwVerification(
      "rollback",
      "access manifest is older than the local checkpoint",
    );
  }

  if (
    current.epoch === normalizedCheckpoint.epoch &&
    current.manifestHash !== normalizedCheckpoint.manifestHash
  ) {
    throwVerification(
      "equivocation",
      "access manifest conflicts with the local checkpoint",
    );
  }

  if (current.epoch === normalizedCheckpoint.epoch) {
    return;
  }

  let expectedEpoch = normalizedCheckpoint.epoch + 1;
  let expectedPreviousHash = normalizedCheckpoint.manifestHash;
  const chain = [
    ...(input.checkpointPredecessors ?? []).map(
      verifiedAccessManifestCheckpointLink,
    ),
    current,
  ];

  for (const link of chain) {
    if (!accessManifestCheckpointObjectMatches(link, normalizedCheckpoint)) {
      throwVerification(
        "object_mismatch",
        "access manifest checkpoint predecessor object mismatch",
      );
    }

    if (
      link.epoch !== expectedEpoch ||
      link.previousManifestHash !== expectedPreviousHash
    ) {
      throwVerification(
        "stale_predecessor",
        "access manifest chain does not extend the local checkpoint",
      );
    }

    expectedEpoch += 1;
    expectedPreviousHash = link.manifestHash;
  }
}
