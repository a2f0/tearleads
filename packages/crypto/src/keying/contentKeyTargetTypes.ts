import type { VerifiedAttachmentBinding } from "./attachmentAccessTypes";
import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import type {
  BlobContentKeyTarget,
  DocumentContentKeyTarget,
  VerifiedContainerKekState,
} from "./containerKekTypes";
import type { VerifiedDocumentLinkSetManifest } from "./documentAccessTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";

export const DOCUMENT_CONTENT_KEY_WRAP_SUITE =
  "tearleads.document.content-key-wrap.aes-256-gcm-container-kek" as const;
export const BLOB_CONTENT_KEY_WRAP_SUITE =
  "tearleads.blob.content-key-wrap.aes-256-gcm-container-kek" as const;

export interface BlobAccessManifest {
  version: 1;
  blobId: string;
  organizationId: string;
  activeBindingIds: string[];
  documentManifestHashes: string[];
  linkedContainerManifestHashes: string[];
  linkedContainerKeyEpochIds: string[];
  blobKeyTargetHash: string;
}

const verifiedDocumentKekTargetsBrand: unique symbol = Symbol(
  "verifiedDocumentKekTargets",
);

const verifiedBlobKekTargetsBrand: unique symbol = Symbol(
  "verifiedBlobKekTargets",
);

export interface VerifiedDocumentKekTargets {
  readonly documentId: string;
  readonly linkSetManifestHash: string;
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly DocumentContentKeyTarget[];
  readonly documentKeyTargetHash: string;
  readonly [verifiedDocumentKekTargetsBrand]: true;
}

export interface VerifiedBlobKekTargets {
  readonly blobId: string;
  readonly organizationId: string;
  readonly activeBindingIds: readonly string[];
  readonly documentManifestHashes: readonly string[];
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly BlobContentKeyTarget[];
  readonly blobKeyTargetHash: string;
  readonly blobAccessManifestHash: string;
  readonly [verifiedBlobKekTargetsBrand]: true;
}

export function makeVerifiedDocumentKekTargets(
  value: Omit<
    VerifiedDocumentKekTargets,
    typeof verifiedDocumentKekTargetsBrand
  >,
): VerifiedDocumentKekTargets {
  return {
    ...value,
    [verifiedDocumentKekTargetsBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedBlobKekTargets(
  value: Omit<VerifiedBlobKekTargets, typeof verifiedBlobKekTargetsBrand>,
): VerifiedBlobKekTargets {
  return {
    ...value,
    [verifiedBlobKekTargetsBrand]: verifiedBrandValue,
  };
}

export interface DeriveDocumentKekTargetsInput {
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
  readonly containerKekStates: readonly VerifiedContainerKekState[];
}

export interface DeriveBlobKekTargetsInput {
  readonly blobId: string;
  readonly activeBindings: readonly VerifiedAttachmentBinding[];
  readonly documentManifests: readonly VerifiedDocumentLinkSetManifest[];
  readonly linkedContainerManifests: readonly VerifiedContainerAccessManifest[];
  readonly containerKekStates: readonly VerifiedContainerKekState[];
}
