import {
  computeAccessEventBodyHash,
  type DocumentPurgeAccessEventBody,
  KeyingVerificationError,
  signAccessEvent,
  type UnsignedAccessEvent,
} from "@symcrypt/crypto";
import type { DocumentPurgeRequest } from "@symcrypt/validators/request";
import type {
  DocumentPurgeProofResponse,
  DocumentPurgeResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  containerPathRefs,
  readLinkedContainerIdsFromDocumentManifest,
} from "../../data/documents/shared/projection";
import {
  assertDocumentManifestBundleConsistent,
  readManifestContainerId,
} from "../../data/documents/shared/readers";
import type {
  DocumentCreateAuthor,
  DocumentSyncApi,
} from "../../data/documents/shared/types";
import {
  readCanonicalJson,
  readCanonicalRecord,
} from "../../data/keyingCanonicalJson";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import {
  verifyDocumentPurgeProof,
  verifyDocumentWriterProjection,
} from "../../data/keyingProjectionVerification";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

interface DocumentPurgeApi {
  getDocumentWriterProjection(
    documentId: string,
  ): Promise<DocumentWriterProjectionResponse | null>;
  purgeDocument(
    documentId: string,
    request: DocumentPurgeRequest,
  ): Promise<DocumentPurgeResponse | null>;
}

export async function buildDocumentPurgeRequest(input: {
  readonly author: DocumentCreateAuthor;
  readonly eventId?: string | undefined;
  readonly signedAt?: string | undefined;
  readonly writerProjection: DocumentWriterProjectionResponse;
}): Promise<DocumentPurgeRequest> {
  const identity = await assertDocumentManifestBundleConsistent({
    bundle: input.writerProjection.documentManifest,
    label: "Document purge predecessor",
  });
  if (identity.documentId !== input.writerProjection.documentId) {
    throw new Error("Document purge projection identity mismatch");
  }
  const linkedContainerIds = readLinkedContainerIdsFromDocumentManifest(
    input.writerProjection,
  );
  if (linkedContainerIds.length !== 1) {
    throw new Error("Document purge requires exactly one linked container");
  }
  const [containerId] = linkedContainerIds;
  const authorizingProjection =
    input.writerProjection.authorizingContainerPaths.find((projection) => {
      const leaf = projection.path.at(-1);
      return leaf && readManifestContainerId(leaf) === containerId;
    });
  const containerManifestHash =
    authorizingProjection?.path.at(-1)?.manifestHash;
  if (!authorizingProjection || !containerId || !containerManifestHash) {
    throw new Error("Document purge authorization path is unavailable");
  }
  const authorizingContainerManifestHashes = authorizingProjection.path.map(
    (bundle) => bundle.manifestHash,
  );
  const body: DocumentPurgeAccessEventBody = {
    authorizingContainerManifestHashes,
    containerId,
    containerManifestHash,
    documentManifestHash: input.writerProjection.documentManifest.manifestHash,
    eventType: "document.purge",
  };
  const unsignedEvent: UnsignedAccessEvent = {
    version: 1,
    eventId: input.eventId ?? crypto.randomUUID(),
    eventType: "document.purge",
    objectKind: "document",
    objectId: input.writerProjection.documentId,
    organizationId: identity.organizationId,
    previousManifestHash: input.writerProjection.documentManifest.manifestHash,
    dependencyManifestHashes: authorizingContainerManifestHashes,
    bodyHash: await computeAccessEventBodyHash(
      readCanonicalJson(body, "Document purge body"),
    ),
    signerUserId: input.author.signerUserId,
    signerDeviceId: input.author.signerDeviceId,
    signerKeyFingerprint: input.author.signerKeyFingerprint,
    signedAt: input.signedAt ?? new Date().toISOString(),
  };
  const event = await signAccessEvent(
    unsignedEvent,
    input.author.signerPrivateKey,
  );

  return {
    authorizingContainerPathRefs: containerPathRefs(authorizingProjection.path),
    body: readCanonicalRecord(body, "Document purge body"),
    event: readCanonicalRecord(event, "Document purge event"),
  };
}

export function createVerifiedRemoteDocumentDeletionHandler(input: {
  readonly apiClient: Pick<DocumentSyncApi, "getDocumentPurgeProof">;
  readonly execSql: ExecSql;
  readonly onVerifiedDeletion?:
    | ((input: { readonly documentId: string }) => Promise<void> | void)
    | undefined;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): (deleted: { readonly documentId: string }) => Promise<void> {
  return async ({ documentId }) => {
    if (!input.apiClient.getDocumentPurgeProof) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Remote document deletion is missing a purge-proof endpoint",
      );
    }
    const proof = await input.apiClient.getDocumentPurgeProof(documentId);
    if (!proof) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Remote document deletion is missing its signed purge proof",
      );
    }
    await verifyRemoteDocumentPurgeProof({
      documentId,
      execSql: input.execSql,
      proof,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    await input.onVerifiedDeletion?.({ documentId });
  };
}

export async function verifyRemoteDocumentPurgeProof(input: {
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly proof: DocumentPurgeProofResponse;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<void> {
  await verifyDocumentPurgeProof({
    execSql: input.execSql,
    expectedDocumentId: input.documentId,
    proof: input.proof,
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}

export async function purgeRemoteDocument(input: {
  readonly apiClient: DocumentPurgeApi;
  readonly author: DocumentCreateAuthor;
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<DocumentPurgeResponse | null> {
  const writerProjection = await input.apiClient.getDocumentWriterProjection(
    input.documentId,
  );
  if (!writerProjection) {
    return null;
  }
  await verifyDocumentWriterProjection({
    execSql: input.execSql,
    projection: writerProjection,
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const request = await buildDocumentPurgeRequest({
    author: input.author,
    writerProjection,
  });
  const response = await input.apiClient.purgeDocument(
    input.documentId,
    request,
  );
  if (!response) {
    return null;
  }
  await verifyRemoteDocumentPurgeProof({
    documentId: input.documentId,
    execSql: input.execSql,
    proof: response,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return response;
}
