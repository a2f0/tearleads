import type { VerifiedAccessEvent } from "./accessEventTypes";
import type {
  AccessManifest,
  AccessManifestCheckpoint,
} from "./accessManifestTypes";
import type { KeyingCanonicalJson } from "./canonicalJsonTypes";
import type { BlobContentKeyTarget } from "./containerKekTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";

export interface DocumentLinkSetStructural {
  linkedContainerIds: string[];
}

export interface DocumentLinkSetManifestState
  extends DocumentLinkSetStructural {
  version: 1;
  documentId: string;
  organizationId: string;
  epoch: number;
  previousManifestHash: string | null;
  eventHash: string;
}

export interface DocumentBlobRewrap {
  readonly blobId: string;
  readonly contentKeyEpoch: number;
  readonly targets: readonly (BlobContentKeyTarget & {
    readonly wrappedKey: string;
    readonly wrappingMetadata: KeyingCanonicalJson;
  })[];
}

export interface DocumentLinkAccessEventBody {
  eventType: "document.link";
  blobRewraps: readonly DocumentBlobRewrap[];
  containerId: string;
  containerManifestHash: string;
}

export interface DocumentUnlinkAccessEventBody {
  eventType: "document.unlink";
  blobRewraps: readonly DocumentBlobRewrap[];
  containerId: string;
  containerManifestHash: string;
}

export type DocumentAccessEventBody =
  | DocumentLinkAccessEventBody
  | DocumentUnlinkAccessEventBody;

const verifiedDocumentLinkSetManifestBrand: unique symbol = Symbol(
  "verifiedDocumentLinkSetManifest",
);
const verifiedDocumentLinkSetStateEvidenceBrand: unique symbol = Symbol();

export interface VerifiedDocumentLinkSetStateEvidence {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  readonly state: DocumentLinkSetManifestState;
  readonly checkpoint: AccessManifestCheckpoint;
  readonly [verifiedDocumentLinkSetStateEvidenceBrand]: true;
}
export interface VerifiedDocumentLinkSetManifest
  extends VerifiedDocumentLinkSetStateEvidence {
  readonly event: VerifiedAccessEvent;
  readonly [verifiedDocumentLinkSetManifestBrand]: true;
}
export type VerifiedDocumentLinkSetSnapshot =
  VerifiedDocumentLinkSetStateEvidence;

export function makeVerifiedDocumentLinkSetManifest(
  value: Omit<
    VerifiedDocumentLinkSetManifest,
    | typeof verifiedDocumentLinkSetManifestBrand
    | typeof verifiedDocumentLinkSetStateEvidenceBrand
  >,
): VerifiedDocumentLinkSetManifest {
  return {
    ...value,
    [verifiedDocumentLinkSetManifestBrand]: verifiedBrandValue,
    [verifiedDocumentLinkSetStateEvidenceBrand]: verifiedBrandValue,
  };
}

export function makeVerifiedDocumentLinkSetSnapshot(
  value: Omit<
    VerifiedDocumentLinkSetSnapshot,
    typeof verifiedDocumentLinkSetStateEvidenceBrand
  >,
): VerifiedDocumentLinkSetSnapshot {
  return {
    ...value,
    [verifiedDocumentLinkSetStateEvidenceBrand]: verifiedBrandValue,
  };
}
