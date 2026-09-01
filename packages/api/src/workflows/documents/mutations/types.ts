import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  VerifiedContainerAccessManifest,
  VerifiedDocumentKekTargets,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  DocumentCreateRequest,
  DocumentLinkSetMutationRequest,
  DocumentPurgeRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type { DocumentPurgeResponse } from "@tearleads/validators/response";

export interface CreateDocumentInput {
  readonly fingerprint: string;
  readonly request: DocumentCreateRequest;
  readonly userId: string;
}

export interface SyncDocumentInput {
  readonly documentId: string;
  readonly fingerprint: string;
  readonly request: DocumentSyncRequest;
  readonly userId: string;
}

export interface MutateDocumentLinkSetInput {
  readonly documentId: string;
  readonly eventType: "document.link" | "document.unlink";
  readonly fingerprint: string;
  readonly request: DocumentLinkSetMutationRequest;
  readonly userId: string;
}

export interface PurgeDocumentWorkflowResult {
  readonly containerIds: readonly string[];
  readonly response: DocumentPurgeResponse;
}

export interface PurgeDocumentInput {
  readonly documentId: string;
  readonly fingerprint: string;
  readonly request: DocumentPurgeRequest;
  readonly userId: string;
}

export interface AppendDocumentUpdatesInput {
  readonly accessEpoch: number;
  readonly accessManifestHash: string;
  readonly accessStateHash: string | null;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly organizationId: string;
  readonly request: DocumentSyncRequest;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
}

export interface DocumentWriteAuthorizationProof {
  readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly documentKekTargets: VerifiedDocumentKekTargets;
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}
