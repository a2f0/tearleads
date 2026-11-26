import type { VerifiedContainerAccessManifest } from "../containerAccess/containerAccessTypes";
import type {
  VerifiedBlobKekTargets,
  VerifiedDocumentKekTargets,
} from "../containerKek/contentKeyTargetTypes";
import { verifiedBrandValue } from "../core/keyingVerifiedBrand";
import type { VerifiedDocumentLinkSetManifest } from "../documentAccess/documentAccessTypes";
import type { PrincipalPolicyAuthorization } from "../principalPolicy/principalPolicyTypes";

export type ContentObjectKind = "blob" | "document";

export const CONTENT_RECORD_ENCRYPTION_SUITE =
  "aes-256-gcm-hkdf-sha256-record-key" as const;
export type ContentRecordEncryptionSuite =
  typeof CONTENT_RECORD_ENCRYPTION_SUITE;

export interface UnsignedWriteHeader {
  dependencyManifestHashes: string[];
  version: 1;
  organizationId: string;
  objectKind: ContentObjectKind;
  objectId: string;
  accessManifestHash: string;
  contentKeyEpoch: number;
  targetHash: string;
  encryptionSuite: ContentRecordEncryptionSuite;
  contentRecordId: string;
  nonceDomainHash: string;
  metadataHash: string;
  ciphertextHash: string;
  writerUserId: string;
  writerDeviceId: string;
  writerKeyFingerprint: string;
  signedAt: string;
}

export interface WriteHeader extends UnsignedWriteHeader {
  signature: string;
}

export interface DocumentContentRecordMetadataInput {
  /**
   * The rotation baseline this update is a segment of. A baseline is an
   * ordered group of updates, written at the epoch a rotation opened, that
   * together carry the document's whole history. Absent on an ordinary
   * update.
   */
  baselineId?: string | undefined;
  /** This segment's place in its baseline, from zero. */
  baselineSegmentIndex?: number | undefined;
  /**
   * On a baseline's final segment only: how many segments the baseline has.
   * A writer signs the earlier segments before it knows the count.
   */
  baselineSegmentCount?: number | undefined;
  /**
   * On a baseline's final segment only: the digest of the segments before
   * it (`computeDocumentBaselineSegmentsDigest`), so a reader that holds
   * them all can tell none was dropped, replaced, or reordered.
   */
  baselineSegmentsDigest?: string | undefined;
  /**
   * On a baseline's final segment only, its author's processed cursor:
   * every update committed at or before it was imported into the baseline
   * or void for its author.
   */
  coversThroughUpdateId?: string | undefined;
  /**
   * The operations the update depends on outside itself, as a version
   * vector: one past each peer's latest such op. The API refuses an update
   * that depends on an op it has not committed, and a reader voids one whose
   * payload depends on other ops than it declares.
   */
  dependencyVersionVector: string;
  documentId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  updateId: string;
}

export interface ContentRecordNonceDomain {
  version: 1;
  organizationId: string;
  objectKind: ContentObjectKind;
  objectId: string;
  contentKeyEpoch: number;
  encryptionSuite: ContentRecordEncryptionSuite;
  contentRecordId: string;
}

const verifiedWriteHeaderBrand: unique symbol = Symbol("verifiedWriteHeader");

export interface VerifiedWriteHeader {
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly nonceDomain: ContentRecordNonceDomain;
  readonly nonceDomainHash: string;
  readonly [verifiedWriteHeaderBrand]: true;
}

export function makeVerifiedWriteHeader(
  value: Omit<VerifiedWriteHeader, typeof verifiedWriteHeaderBrand>,
): VerifiedWriteHeader {
  return {
    ...value,
    [verifiedWriteHeaderBrand]: verifiedBrandValue,
  };
}

interface ExpectedWriteObject {
  readonly objectKind: ContentObjectKind;
  readonly objectId: string;
  readonly organizationId?: string;
}

export interface VerifyWriteHeaderInput {
  readonly authorizationMembership?: "current" | "referenced";
  readonly header: WriteHeader;
  readonly writerPublicKey: Uint8Array;
  readonly expectedObject?: ExpectedWriteObject;
  readonly expectedAccessManifestHash?: string;
  readonly expectedTargetHash?: string;
  readonly documentAuthorization?: {
    readonly documentManifest: VerifiedDocumentLinkSetManifest;
    readonly documentKekTargets: VerifiedDocumentKekTargets;
    readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
    readonly principalPolicies?: readonly PrincipalPolicyAuthorization[];
  };
  readonly blobAuthorization?: {
    readonly blobKekTargets: VerifiedBlobKekTargets;
    readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
    readonly principalPolicies?: readonly PrincipalPolicyAuthorization[];
  };
}
