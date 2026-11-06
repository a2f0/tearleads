import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import type {
  VerifiedBlobKekTargets,
  VerifiedDocumentKekTargets,
} from "./contentKeyTargetTypes";
import type { VerifiedDocumentLinkSetManifest } from "./documentAccessTypes";
import { verifiedBrandValue } from "./keyingVerifiedBrand";
import type { PrincipalPolicyAuthorization } from "./principalPolicyTypes";

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
  checkpointKind?: "rotate_baseline";
  checkpointPayloadKind?: "full_history_snapshot";
  documentId: string;
  partialEndVersionVector: string;
  partialStartVersionVector: string;
  plaintextHash: string;
  sourceVersionVector?: string;
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
