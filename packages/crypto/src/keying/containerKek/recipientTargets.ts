import { normalizeReferencedPrincipalHead } from "../accessEvent";
import { computeKeyingDomainHash } from "../canonical";
import type { KeyingCanonicalPayload } from "../canonicalJsonTypes";
import { principalPolicyMatchesReference } from "../containerAccess";
import type {
  ContainerAccessManifestState,
  ContainerDirectGrant,
} from "../containerAccessTypes";
import type {
  ContainerKekParentBinding,
  ContainerKekRecipientTarget,
  ContainerUserRecipientKey,
  DeriveContainerKekRecipientTargetsInput,
} from "../containerKekTypes";
import { normalizeContainerUserRecipientKey } from "../containerUserRecipientKey";
import type {
  PrincipalPolicyAuthorization,
  ReferencedPrincipalHead,
} from "../principalPolicyTypes";
import {
  assertExactKeys,
  normalizeKekRecipientKind,
  normalizeSortedUniqueArray,
  ok,
  readHashString,
  readString,
  throwVerification,
  toVerificationResult,
} from "../shared";
import type { KeyingVerificationResult } from "../verificationError";

export function derivePrincipalRecipientKeyEpochId(
  reference: ReferencedPrincipalHead,
): string {
  const normalizedReference = normalizeReferencedPrincipalHead(reference);

  return [
    normalizedReference.principalType,
    normalizedReference.principalId,
    normalizedReference.keyEpoch,
    normalizedReference.stateHash,
  ].join(":");
}

function buildContainerUserRecipientKeyMap(
  userRecipientKeys: readonly ContainerUserRecipientKey[],
): Map<string, ContainerUserRecipientKey> {
  const userKeyByUserId = new Map<string, ContainerUserRecipientKey>();

  for (const userKey of userRecipientKeys.map(
    normalizeContainerUserRecipientKey,
  )) {
    if (userKeyByUserId.has(userKey.userId)) {
      throwVerification(
        "duplicate_entry",
        "container user recipient keys contain a duplicate user",
      );
    }

    userKeyByUserId.set(userKey.userId, userKey);
  }

  return userKeyByUserId;
}

function requirePrincipalRecipientTarget(input: {
  readonly grant: ContainerDirectGrant;
  readonly state: ContainerAccessManifestState;
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
}): ContainerKekRecipientTarget {
  if (input.grant.subjectType === "user") {
    throwVerification(
      "invalid_domain",
      "user grants do not have principal recipient targets",
    );
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires a referenced principal head",
    );
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );

  if (!verifiedPolicy) {
    throwVerification(
      "missing_dependency",
      "container KEK target derivation requires the verified principal policy",
    );
  }

  return {
    recipientKind: "group",
    recipientId: referencedHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(referencedHead),
    recipientKeyFingerprint: referencedHead.keyFingerprint,
  };
}

export function deriveContainerKekRecipientTargetsOrThrow({
  containerManifest,
  parentKekState = null,
  principalPolicies = [],
  userRecipientKeys = [],
}: Omit<DeriveContainerKekRecipientTargetsInput, "parentKekState"> & {
  readonly parentKekState?: ContainerKekParentBinding | null;
}): ContainerKekRecipientTarget[] {
  const targets: ContainerKekRecipientTarget[] = [];
  const userKeyByUserId = buildContainerUserRecipientKeyMap(userRecipientKeys);

  for (const grant of containerManifest.state.directGrants) {
    if (grant.subjectType === "user") {
      const userKey = userKeyByUserId.get(grant.subjectId);

      if (!userKey) {
        throwVerification(
          "missing_dependency",
          "container KEK target derivation requires a user recipient key",
        );
      }

      targets.push({
        recipientKind: "user",
        recipientId: grant.subjectId,
        recipientKeyEpochId: userKey.recipientKeyEpochId,
        recipientKeyFingerprint: userKey.recipientKeyFingerprint,
      });
      continue;
    }

    targets.push(
      requirePrincipalRecipientTarget({
        grant,
        state: containerManifest.state,
        principalPolicies,
      }),
    );
  }

  if (containerManifest.state.parentContainerId) {
    if (!parentKekState) {
      throwVerification(
        "missing_dependency",
        "container KEK target derivation requires verified parent KEK state",
      );
    }

    if (
      parentKekState.containerId !== containerManifest.state.parentContainerId
    ) {
      throwVerification(
        "object_mismatch",
        "container KEK parent target points at the wrong parent container",
      );
    }

    targets.push({
      recipientKind: "container",
      recipientId: parentKekState.containerId,
      recipientKeyEpochId: parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: parentKekState.keyEpochHash,
    });
  }

  return normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );
}

export function deriveContainerKekRecipientTargets(
  input: DeriveContainerKekRecipientTargetsInput,
): KeyingVerificationResult<readonly ContainerKekRecipientTarget[]> {
  try {
    return ok(deriveContainerKekRecipientTargetsOrThrow(input));
  } catch (error) {
    return toVerificationResult(error);
  }
}

function normalizeContainerKekRecipientTarget(
  value: unknown,
): ContainerKekRecipientTarget {
  const record = assertExactKeys(
    value,
    [
      "recipientId",
      "recipientKeyEpochId",
      "recipientKeyFingerprint",
      "recipientKind",
    ],
    "container KEK recipient target",
  );

  return {
    recipientKind: normalizeKekRecipientKind(
      record.recipientKind,
      "container KEK recipient target",
    ),
    recipientId: readString(
      record,
      "recipientId",
      "container KEK recipient target",
    ),
    recipientKeyEpochId: readString(
      record,
      "recipientKeyEpochId",
      "container KEK recipient target",
    ),
    recipientKeyFingerprint: readHashString(
      record,
      "recipientKeyFingerprint",
      "container KEK recipient target",
    ),
  };
}

export function containerKekRecipientTargetKey(
  target: ContainerKekRecipientTarget,
): string {
  return `${target.recipientKind}:${target.recipientId}:${target.recipientKeyEpochId}`;
}

export async function computeContainerKekRecipientTargetHash(
  targets: readonly ContainerKekRecipientTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeContainerKekRecipientTarget,
    containerKekRecipientTargetKey,
    "container KEK recipient targets",
  );
  const payload: KeyingCanonicalPayload<
    readonly ContainerKekRecipientTarget[]
  > = normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.container-kek-recipient-targets",
    payload,
  );
}
