import type { VerifiedAttachmentBinding } from "../attachmentAccessTypes";
import { computeKeyingDomainHash } from "../canonical";
import type { KeyingCanonicalPayload } from "../canonicalJsonTypes";
import type { VerifiedContainerAccessManifest } from "../containerAccessTypes";
import type {
  BlobContentKeyTarget,
  VerifiedContainerKekState,
} from "../containerKekTypes";
import type {
  DeriveBlobKekTargetsInput,
  VerifiedBlobKekTargets,
} from "../contentKeyTargetTypes";
import { makeVerifiedBlobKekTargets } from "../contentKeyTargetTypes";
import { requireEventDependency } from "../documentAccessAuthorization";
import type { VerifiedDocumentLinkSetManifest } from "../documentAccessTypes";
import {
  assertExactKeys,
  compareCanonicalStrings,
  normalizeSortedUniqueArray,
  readHashString,
  readPositiveInteger,
  readString,
  runVerifier,
  throwVerification,
} from "../shared";
import type { KeyingVerificationResult } from "../verificationError";
import { computeBlobAccessManifestHash } from "./blobAccessManifest";
import {
  containerKekTargetKey,
  deriveDocumentKekTargets,
} from "./documentKeyTargets";

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
