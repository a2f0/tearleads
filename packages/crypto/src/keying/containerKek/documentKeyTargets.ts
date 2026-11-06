import { computeKeyingDomainHash } from "../canonical";
import type { KeyingCanonicalPayload } from "../canonicalJsonTypes";
import type { VerifiedContainerAccessManifest } from "../containerAccessTypes";
import type {
  ContainerKekTarget,
  DocumentContentKeyTarget,
  VerifiedContainerKekState,
} from "../containerKekTypes";
import type {
  DeriveDocumentKekTargetsInput,
  VerifiedDocumentKekTargets,
} from "../contentKeyTargetTypes";
import { makeVerifiedDocumentKekTargets } from "../contentKeyTargetTypes";
import type { VerifiedDocumentLinkSetManifest } from "../documentAccessTypes";
import {
  assertExactKeys,
  normalizeSortedUniqueArray,
  readHashString,
  readPositiveInteger,
  readString,
  runVerifier,
  throwVerification,
} from "../shared";
import type { KeyingVerificationResult } from "../verificationError";

function normalizeContainerKekTarget(
  value: unknown,
  label: string,
): ContainerKekTarget {
  const record = assertExactKeys(
    value,
    [
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
    ],
    label,
  );

  return {
    containerId: readString(record, "containerId", label),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      label,
    ),
    containerKeyEpochId: readString(record, "containerKeyEpochId", label),
    containerKeyEpoch: readPositiveInteger(record, "containerKeyEpoch", label),
  };
}

export function containerKekTargetKey(target: ContainerKekTarget): string {
  return `${target.containerId}:${target.containerKeyEpochId}`;
}

export async function computeDocumentContentKeyTargetHash(
  targets: readonly DocumentContentKeyTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    (target) =>
      normalizeContainerKekTarget(target, "document content-key target"),
    containerKekTargetKey,
    "document content-key targets",
  );
  const payload: KeyingCanonicalPayload<readonly DocumentContentKeyTarget[]> =
    normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.document-content-key-targets",
    payload,
  );
}

function uniqueContainerManifestMap(
  manifests: readonly VerifiedContainerAccessManifest[],
): Map<string, VerifiedContainerAccessManifest> {
  const manifestByContainerId = new Map<
    string,
    VerifiedContainerAccessManifest
  >();

  for (const containerManifest of manifests) {
    if (manifestByContainerId.has(containerManifest.state.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container manifest",
      );
    }
    manifestByContainerId.set(
      containerManifest.state.containerId,
      containerManifest,
    );
  }

  return manifestByContainerId;
}

function uniqueContainerKekStateMap(
  states: readonly VerifiedContainerKekState[],
): Map<string, VerifiedContainerKekState> {
  const kekStateByContainerId = new Map<string, VerifiedContainerKekState>();

  for (const kekState of states) {
    if (kekStateByContainerId.has(kekState.containerId)) {
      throwVerification(
        "duplicate_entry",
        "document KEK target derivation contains a duplicate container KEK state",
      );
    }
    kekStateByContainerId.set(kekState.containerId, kekState);
  }

  return kekStateByContainerId;
}

function deriveLinkedDocumentKekTarget(input: {
  readonly containerId: string;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly manifestByContainerId: ReadonlyMap<
    string,
    VerifiedContainerAccessManifest
  >;
  readonly kekStateByContainerId: ReadonlyMap<
    string,
    VerifiedContainerKekState
  >;
}): DocumentContentKeyTarget {
  const containerManifest = input.manifestByContainerId.get(input.containerId);
  const kekState = input.kekStateByContainerId.get(input.containerId);

  if (!containerManifest || !kekState) {
    throwVerification(
      "missing_dependency",
      "document KEK target derivation is missing a linked container target",
    );
  }

  if (
    containerManifest.state.organizationId !==
      input.documentManifest.state.organizationId ||
    kekState.containerId !== input.containerId
  ) {
    throwVerification(
      "object_mismatch",
      "document KEK target belongs to the wrong document organization or container",
    );
  }

  if (kekState.accessManifestHash !== containerManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document KEK target container manifest is stale",
    );
  }

  if (
    containerManifest.state.containerKeyEpochId === null ||
    kekState.containerKeyEpochId !== containerManifest.state.containerKeyEpochId
  ) {
    throwVerification(
      "key_epoch_reuse",
      "document KEK target container key epoch does not match the manifest",
    );
  }

  return {
    containerId: input.containerId,
    containerManifestHash: containerManifest.manifestHash,
    containerKeyEpochId: kekState.containerKeyEpochId,
    containerKeyEpoch: kekState.containerKeyEpoch,
  };
}

async function buildVerifiedDocumentKekTargets(input: {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly targets: readonly DocumentContentKeyTarget[];
}): Promise<VerifiedDocumentKekTargets> {
  const targets = {
    documentId: input.documentManifest.state.documentId,
    linkSetManifestHash: input.documentManifest.manifestHash,
    linkedContainerManifestHashes: input.targets.map(
      (target) => target.containerManifestHash,
    ),
    linkedContainerKeyEpochIds: input.targets.map(
      (target) => target.containerKeyEpochId,
    ),
    targets: input.targets,
    documentKeyTargetHash: await computeDocumentContentKeyTargetHash(
      input.targets,
    ),
  };

  return makeVerifiedDocumentKekTargets(targets);
}

export async function deriveDocumentKekTargets({
  containerKekStates,
  documentManifest,
  linkedContainerManifests,
}: DeriveDocumentKekTargetsInput): Promise<
  KeyingVerificationResult<VerifiedDocumentKekTargets>
> {
  return runVerifier(async () => {
    const manifestByContainerId = uniqueContainerManifestMap(
      linkedContainerManifests,
    );
    const kekStateByContainerId =
      uniqueContainerKekStateMap(containerKekStates);

    const normalizedTargets = normalizeSortedUniqueArray(
      documentManifest.state.linkedContainerIds.map((containerId) =>
        deriveLinkedDocumentKekTarget({
          containerId,
          documentManifest,
          manifestByContainerId,
          kekStateByContainerId,
        }),
      ),
      (target) =>
        normalizeContainerKekTarget(target, "document content-key target"),
      containerKekTargetKey,
      "document content-key targets",
    );

    return buildVerifiedDocumentKekTargets({
      documentManifest,
      targets: normalizedTargets,
    });
  });
}
