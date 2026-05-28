import { computeKeyingDomainHash } from "../canonical";
import { requireEventDependency } from "../documentAccess";
import {
  assertExactKeys,
  compareCanonicalStrings,
  normalizeSortedUniqueArray,
  normalizeUniqueSortedStrings,
  readHashString,
  readPositiveInteger,
  readString,
  readStringArray,
  readVersion,
  runVerifier,
  throwVerification,
} from "../shared";
import type {
  BlobAccessManifest,
  BlobContentKeyTarget,
  ContainerKekTarget,
  DeriveBlobKekTargetsInput,
  DeriveDocumentKekTargetsInput,
  DocumentContentKeyTarget,
  KeyingCanonicalPayload,
  KeyingVerificationResult,
  VerifiedAttachmentBinding,
  VerifiedBlobKekTargets,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
} from "../types";
import {
  makeVerifiedBlobKekTargets,
  makeVerifiedDocumentKekTargets,
} from "../types";

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

function containerKekTargetKey(target: ContainerKekTarget): string {
  return `${target.containerId}:${target.containerKeyEpochId}`;
}

function normalizeBlobContentKeyTarget(value: unknown): BlobContentKeyTarget {
  const record = assertExactKeys(
    value,
    [
      "bindingId",
      "containerId",
      "containerKeyEpoch",
      "containerKeyEpochId",
      "containerManifestHash",
      "documentId",
    ],
    "blob content-key target",
  );

  return {
    containerId: readString(record, "containerId", "blob content-key target"),
    containerManifestHash: readHashString(
      record,
      "containerManifestHash",
      "blob content-key target",
    ),
    containerKeyEpochId: readString(
      record,
      "containerKeyEpochId",
      "blob content-key target",
    ),
    containerKeyEpoch: readPositiveInteger(
      record,
      "containerKeyEpoch",
      "blob content-key target",
    ),
    bindingId: readString(record, "bindingId", "blob content-key target"),
    documentId: readString(record, "documentId", "blob content-key target"),
  };
}

function blobContentKeyTargetKey(target: BlobContentKeyTarget): string {
  return `${target.bindingId}:${target.documentId}:${containerKekTargetKey(target)}`;
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

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function uniqueDocumentManifestMap(
  manifests: readonly VerifiedDocumentLinkSetManifest[],
): Map<string, VerifiedDocumentLinkSetManifest> {
  const manifestByDocumentId = new Map<
    string,
    VerifiedDocumentLinkSetManifest
  >();

  for (const documentManifest of manifests) {
    if (manifestByDocumentId.has(documentManifest.state.documentId)) {
      throwVerification(
        "duplicate_entry",
        "blob KEK target derivation contains a duplicate document manifest",
      );
    }
    manifestByDocumentId.set(
      documentManifest.state.documentId,
      documentManifest,
    );
  }

  return manifestByDocumentId;
}

function normalizeActiveAttachmentBindings(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
}): VerifiedAttachmentBinding[] {
  if (input.activeBindings.length === 0) {
    throwVerification(
      "missing_dependency",
      "blob KEK target derivation requires an active attachment binding",
    );
  }

  const normalizedBindings = [...input.activeBindings].sort((left, right) =>
    compareCanonicalStrings(left.bindingId, right.bindingId),
  );

  let previousBindingId: string | null = null;
  for (const binding of normalizedBindings) {
    if (binding.blobId !== input.blobId) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding targets the wrong blob",
      );
    }

    if (
      binding.body.bindingId !== binding.bindingId ||
      binding.body.blobId !== binding.blobId ||
      binding.body.documentId !== binding.documentId ||
      binding.body.slotId !== binding.slotId ||
      binding.body.documentManifestHash !== binding.documentManifestHash
    ) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding body does not match projection",
      );
    }

    if (binding.event.event.objectKind !== "blob") {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding event must target a blob",
      );
    }

    if (
      binding.event.event.eventType !== "attachment.bind" ||
      binding.event.event.objectId !== input.blobId
    ) {
      throwVerification(
        "object_mismatch",
        "blob KEK target derivation binding event does not match blob",
      );
    }

    if (previousBindingId === binding.bindingId) {
      throwVerification(
        "duplicate_entry",
        "blob KEK target derivation contains a duplicate attachment binding",
      );
    }
    previousBindingId = binding.bindingId;
  }

  return normalizedBindings;
}

function requireDocumentManifestForBinding(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly documentManifestById: ReadonlyMap<
    string,
    VerifiedDocumentLinkSetManifest
  >;
}): VerifiedDocumentLinkSetManifest {
  const documentManifest = input.documentManifestById.get(
    input.binding.documentId,
  );

  if (!documentManifest) {
    throwVerification(
      "missing_dependency",
      "blob KEK target derivation is missing a binding document manifest",
    );
  }

  if (
    documentManifest.state.organizationId !==
    input.binding.event.event.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "blob KEK target derivation document manifest belongs to the wrong organization",
    );
  }

  requireEventDependency({
    event: input.binding.event,
    manifestHash: input.binding.documentManifestHash,
    label: "blob KEK target derivation attachment binding",
  });

  return documentManifest;
}

async function deriveBlobKekTargetsForBinding(input: {
  readonly binding: VerifiedAttachmentBinding;
  readonly containerKekStates: readonly VerifiedContainerKekState[];
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
}): Promise<BlobContentKeyTarget[]> {
  const documentTargets = await deriveDocumentKekTargets({
    documentManifest: input.documentManifest,
    linkedContainerManifests: input.linkedContainerManifests,
    containerKekStates: input.containerKekStates,
  });

  if (!documentTargets.ok) {
    throw documentTargets.error;
  }

  return documentTargets.value.targets.map((target) => ({
    ...target,
    bindingId: input.binding.bindingId,
    documentId: input.binding.documentId,
  }));
}

async function buildVerifiedBlobKekTargets(input: {
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly blobId: string;
  readonly documentManifests: readonly VerifiedDocumentLinkSetManifest[];
  readonly targets: readonly BlobContentKeyTarget[];
}): Promise<VerifiedBlobKekTargets> {
  const organizationIds = uniqueSortedStrings(
    input.documentManifests.map((manifest) => manifest.state.organizationId),
  );
  const organizationId = organizationIds[0];
  if (!organizationId || organizationIds.length !== 1) {
    throwVerification(
      "object_mismatch",
      "blob KEK target derivation must stay within one organization",
    );
  }
  const blobKeyTargetHash = await computeBlobContentKeyTargetHash(
    input.targets,
  );
  const blobAccessManifestHash = await computeBlobAccessManifestHash({
    version: 1,
    blobId: input.blobId,
    organizationId,
    activeBindingIds: input.activeBindings.map((binding) => binding.bindingId),
    documentManifestHashes: uniqueSortedStrings(
      input.documentManifests.map((manifest) => manifest.manifestHash),
    ),
    linkedContainerManifestHashes: uniqueSortedStrings(
      input.targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      input.targets.map((target) => target.containerKeyEpochId),
    ),
    blobKeyTargetHash,
  });

  const targets = {
    blobId: input.blobId,
    organizationId,
    activeBindingIds: input.activeBindings.map((binding) => binding.bindingId),
    documentManifestHashes: uniqueSortedStrings(
      input.documentManifests.map((manifest) => manifest.manifestHash),
    ),
    linkedContainerManifestHashes: uniqueSortedStrings(
      input.targets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      input.targets.map((target) => target.containerKeyEpochId),
    ),
    targets: input.targets,
    blobKeyTargetHash,
    blobAccessManifestHash,
  };

  return makeVerifiedBlobKekTargets(targets);
}

export async function deriveBlobKekTargets({
  activeBindings,
  blobId,
  containerKekStates,
  documentManifests,
  linkedContainerManifests,
}: DeriveBlobKekTargetsInput): Promise<
  KeyingVerificationResult<VerifiedBlobKekTargets>
> {
  return runVerifier(async () => {
    const normalizedBindings = normalizeActiveAttachmentBindings({
      activeBindings,
      blobId,
    });
    const documentManifestById = uniqueDocumentManifestMap(documentManifests);
    const targets: BlobContentKeyTarget[] = [];

    for (const binding of normalizedBindings) {
      const documentManifest = requireDocumentManifestForBinding({
        binding,
        documentManifestById,
      });
      targets.push(
        ...(await deriveBlobKekTargetsForBinding({
          binding,
          documentManifest,
          linkedContainerManifests,
          containerKekStates,
        })),
      );
    }

    const normalizedTargets = normalizeSortedUniqueArray(
      targets,
      normalizeBlobContentKeyTarget,
      blobContentKeyTargetKey,
      "blob content-key targets",
    );

    return buildVerifiedBlobKekTargets({
      activeBindings: normalizedBindings,
      blobId,
      documentManifests: normalizedBindings.map((binding) =>
        requireDocumentManifestForBinding({ binding, documentManifestById }),
      ),
      targets: normalizedTargets,
    });
  });
}

export async function computeBlobContentKeyTargetHash(
  targets: readonly BlobContentKeyTarget[],
): Promise<string> {
  const normalizedTargets = normalizeSortedUniqueArray(
    targets,
    normalizeBlobContentKeyTarget,
    blobContentKeyTargetKey,
    "blob content-key targets",
  );
  const payload: KeyingCanonicalPayload<readonly BlobContentKeyTarget[]> =
    normalizedTargets;

  return computeKeyingDomainHash(
    "tearleads.keying.blob-content-key-targets",
    payload,
  );
}

function normalizeHashStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const values = normalizeUniqueSortedStrings(
    readStringArray(record, key, label),
    `${label}.${key}`,
  );

  for (const [index, value] of values.entries()) {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throwVerification(
        "hash_mismatch",
        `${label}.${key}[${index}] must be a 64-character lowercase hex hash`,
      );
    }
  }

  return values;
}

function normalizeBlobAccessManifest(value: unknown): BlobAccessManifest {
  const record = assertExactKeys(
    value,
    [
      "activeBindingIds",
      "blobId",
      "blobKeyTargetHash",
      "documentManifestHashes",
      "linkedContainerKeyEpochIds",
      "linkedContainerManifestHashes",
      "organizationId",
      "version",
    ],
    "blob access manifest",
  );

  return {
    version: readVersion(record, "blob access manifest"),
    blobId: readString(record, "blobId", "blob access manifest"),
    organizationId: readString(
      record,
      "organizationId",
      "blob access manifest",
    ),
    activeBindingIds: normalizeUniqueSortedStrings(
      readStringArray(record, "activeBindingIds", "blob access manifest"),
      "blob access manifest.activeBindingIds",
    ),
    documentManifestHashes: normalizeHashStringArray(
      record,
      "documentManifestHashes",
      "blob access manifest",
    ),
    linkedContainerManifestHashes: normalizeHashStringArray(
      record,
      "linkedContainerManifestHashes",
      "blob access manifest",
    ),
    linkedContainerKeyEpochIds: normalizeUniqueSortedStrings(
      readStringArray(
        record,
        "linkedContainerKeyEpochIds",
        "blob access manifest",
      ),
      "blob access manifest.linkedContainerKeyEpochIds",
    ),
    blobKeyTargetHash: readHashString(
      record,
      "blobKeyTargetHash",
      "blob access manifest",
    ),
  };
}

export async function computeBlobAccessManifestHash(
  manifest: BlobAccessManifest,
): Promise<string> {
  const payload: KeyingCanonicalPayload<BlobAccessManifest> =
    normalizeBlobAccessManifest(manifest);

  return computeKeyingDomainHash(
    "tearleads.keying.blob-access-manifest",
    payload,
  );
}
