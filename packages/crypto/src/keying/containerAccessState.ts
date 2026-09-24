import { referencedPrincipalKey } from "./accessEvent";
import { computeKeyingDomainHash } from "./canonical";
import {
  normalizeContainerAccessMetadata,
  normalizeContainerAccessStructural,
  normalizeContainerAccessStructuralState,
} from "./containerAccessStructure";
import { normalizeContainerGrantPrincipalHeads } from "./containerGrantPrincipalHead";
import { normalizeContainerKekWrappingPublicKey } from "./containerKekWrapping";

import {
  assertExactKeys,
  normalizeContainerAccessLevel,
  normalizeContainerGrantSubjectType,
  normalizeSortedUniqueArray,
  readHashString,
  readNullableHashString,
  readNullableString,
  readPositiveInteger,
  readString,
  readVersion,
  throwVerification,
} from "./shared";
import type {
  ContainerAccessKeyState,
  ContainerAccessManifest,
  ContainerAccessManifestState,
  ContainerAccessMetadata,
  ContainerAccessStructural,
  ContainerDirectGrant,
  ContainerGrantPrincipalHead,
  KeyingCanonicalPayload,
} from "./types";

export function normalizeContainerDirectGrant(
  value: unknown,
): ContainerDirectGrant {
  const record = assertExactKeys(
    value,
    ["accessLevel", "subjectId", "subjectType"],
    "container direct grant",
  );

  return {
    accessLevel: normalizeContainerAccessLevel(
      record.accessLevel,
      "container direct grant",
    ),
    subjectId: readString(record, "subjectId", "container direct grant"),
    subjectType: normalizeContainerGrantSubjectType(
      record.subjectType,
      "container direct grant",
    ),
  };
}

function containerDirectGrantKey(grant: ContainerDirectGrant): string {
  return `${grant.subjectType}:${grant.subjectId}`;
}

export function normalizeContainerDirectGrants(
  values: readonly unknown[],
): ContainerDirectGrant[] {
  return normalizeSortedUniqueArray(
    values,
    normalizeContainerDirectGrant,
    containerDirectGrantKey,
    "container direct grants",
  );
}

export function normalizeContainerAccessKeyState(
  value: unknown,
): ContainerAccessKeyState {
  const record = assertExactKeys(
    value,
    ["containerKeyEpochId", "containerKeyPublicKey"],
    "container access key state",
  );
  const containerKeyEpochId = readNullableString(
    record,
    "containerKeyEpochId",
    "container access key state",
  );
  const containerKeyPublicKey = normalizeContainerKekWrappingPublicKey(
    record.containerKeyPublicKey,
  );
  if ((containerKeyEpochId === null) !== (containerKeyPublicKey === null)) {
    throwVerification(
      "invalid_shape",
      "Container KEK epoch and public key must both be present or both be null",
    );
  }
  return { containerKeyEpochId, containerKeyPublicKey };
}

export function managedGrantReferenceKey(
  grant: ContainerDirectGrant,
): string | null {
  if (grant.subjectType === "user") {
    return null;
  }

  return `${grant.subjectType}:${grant.subjectId}`;
}

export function assertReferencedPrincipalHeadsMatchDirectGrants(input: {
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly referencedPrincipalHeads: readonly ContainerGrantPrincipalHead[];
}): void {
  const managedGrantKeys = new Set<string>();
  for (const grant of input.directGrants) {
    const key = managedGrantReferenceKey(grant);
    if (key) {
      managedGrantKeys.add(key);
    }
  }

  const referencedKeys = new Set<string>();
  for (const principalHead of input.referencedPrincipalHeads) {
    referencedKeys.add(referencedPrincipalKey(principalHead));
  }

  for (const grantKey of managedGrantKeys) {
    if (!referencedKeys.has(grantKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest is missing a referenced principal head",
      );
    }
  }

  for (const referencedKey of referencedKeys) {
    if (!managedGrantKeys.has(referencedKey)) {
      throwVerification(
        "missing_dependency",
        "container access manifest references a principal without a direct grant",
      );
    }
  }
}

function normalizeContainerAccessGrantState(input: {
  readonly directGrants: unknown;
  readonly label: string;
  readonly referencedPrincipalHeads: unknown;
}): Pick<
  ContainerAccessManifestState,
  "directGrants" | "referencedPrincipalHeads"
> {
  if (!Array.isArray(input.directGrants)) {
    throwVerification(
      "invalid_shape",
      `${input.label}.directGrants must be an array`,
    );
  }

  if (!Array.isArray(input.referencedPrincipalHeads)) {
    throwVerification(
      "invalid_shape",
      `${input.label}.referencedPrincipalHeads must be an array`,
    );
  }

  const directGrants = normalizeContainerDirectGrants(input.directGrants);
  const referencedPrincipalHeads = normalizeContainerGrantPrincipalHeads(
    input.referencedPrincipalHeads,
  );

  assertReferencedPrincipalHeadsMatchDirectGrants({
    directGrants,
    referencedPrincipalHeads,
  });

  return { directGrants, referencedPrincipalHeads };
}

export function normalizeContainerAccessManifestState(
  value: ContainerAccessManifestState,
): ContainerAccessManifestState {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpochId",
      "containerKeyPublicKey",
      "directGrants",
      "epoch",
      "eventHash",
      "metadataDocumentId",
      "systemSlot",
      "organizationId",
      "parentContainerId",
      "parentManifestHash",
      "previousManifestHash",
      "referencedPrincipalHeads",
      "version",
    ],
    "container access manifest state",
  );
  const structural = normalizeContainerAccessStructural({
    parentContainerId: record.parentContainerId,
    parentManifestHash: record.parentManifestHash,
  });
  const keyState = normalizeContainerAccessKeyState({
    containerKeyEpochId: record.containerKeyEpochId,
    containerKeyPublicKey: record.containerKeyPublicKey,
  });
  const metadata = normalizeContainerAccessMetadata({
    metadataDocumentId: record.metadataDocumentId,
    systemSlot: record.systemSlot,
  });
  const grants = normalizeContainerAccessGrantState({
    directGrants: record.directGrants,
    referencedPrincipalHeads: record.referencedPrincipalHeads,
    label: "container access manifest state",
  });

  return {
    version: readVersion(record, "container access manifest state"),
    containerId: readString(
      record,
      "containerId",
      "container access manifest state",
    ),
    organizationId: readString(
      record,
      "organizationId",
      "container access manifest state",
    ),
    epoch: readPositiveInteger(
      record,
      "epoch",
      "container access manifest state",
    ),
    previousManifestHash: readNullableHashString(
      record,
      "previousManifestHash",
      "container access manifest state",
    ),
    eventHash: readHashString(
      record,
      "eventHash",
      "container access manifest state",
    ),
    ...structural,
    ...keyState,
    ...metadata,
    ...grants,
  };
}

export async function computeContainerAccessStructuralHash(
  structural: ContainerAccessStructural & ContainerAccessMetadata,
): Promise<string> {
  const payload: KeyingCanonicalPayload<
    ContainerAccessStructural & ContainerAccessMetadata
  > = normalizeContainerAccessStructuralState(structural);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-structural",
    payload,
  );
}

export async function computeContainerDirectGrantRoot(
  grants: readonly ContainerDirectGrant[],
): Promise<string> {
  const payload: KeyingCanonicalPayload<readonly ContainerDirectGrant[]> =
    normalizeContainerDirectGrants(grants);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-direct-grants",
    payload,
  );
}

export async function computeContainerAccessKeyTargetHash(
  keyState: ContainerAccessKeyState,
): Promise<string> {
  const payload: KeyingCanonicalPayload<ContainerAccessKeyState> =
    normalizeContainerAccessKeyState(keyState);

  return computeKeyingDomainHash(
    "tearleads.keying.container-access-key-target",
    payload,
  );
}

export async function deriveContainerAccessManifest(
  state: ContainerAccessManifestState,
): Promise<ContainerAccessManifest> {
  const normalizedState = normalizeContainerAccessManifestState(state);

  return {
    version: 1,
    objectKind: "container",
    objectId: normalizedState.containerId,
    organizationId: normalizedState.organizationId,
    epoch: normalizedState.epoch,
    previousManifestHash: normalizedState.previousManifestHash,
    eventHash: normalizedState.eventHash,
    structuralHash: await computeContainerAccessStructuralHash({
      metadataDocumentId: normalizedState.metadataDocumentId,
      systemSlot: normalizedState.systemSlot,
      parentContainerId: normalizedState.parentContainerId,
      parentManifestHash: normalizedState.parentManifestHash,
    }),
    grantRoot: await computeContainerDirectGrantRoot(
      normalizedState.directGrants,
    ),
    referencedPrincipalHeads: normalizedState.referencedPrincipalHeads,
    keyTargetHash: await computeContainerAccessKeyTargetHash({
      containerKeyEpochId: normalizedState.containerKeyEpochId,
      containerKeyPublicKey: normalizedState.containerKeyPublicKey,
    }),
  };
}

export function upsertContainerDirectGrant(
  grants: readonly ContainerDirectGrant[],
  grant: ContainerDirectGrant,
): ContainerDirectGrant[] {
  const nextGrants = grants.filter(
    (existingGrant) =>
      containerDirectGrantKey(existingGrant) !== containerDirectGrantKey(grant),
  );
  nextGrants.push(grant);
  return normalizeContainerDirectGrants(nextGrants);
}

export function removeContainerDirectGrant(
  grants: readonly ContainerDirectGrant[],
  revokedGrant: Pick<ContainerDirectGrant, "subjectId" | "subjectType">,
): ContainerDirectGrant[] {
  const revokedGrantKey = `${revokedGrant.subjectType}:${revokedGrant.subjectId}`;
  return normalizeContainerDirectGrants(
    grants.filter(
      (existingGrant) =>
        containerDirectGrantKey(existingGrant) !== revokedGrantKey,
    ),
  );
}
