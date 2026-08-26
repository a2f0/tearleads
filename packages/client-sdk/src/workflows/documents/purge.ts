import {
  computeAccessEventBodyHash,
  type DocumentPurgeAccessEventBody,
  KeyingVerificationError,
  signAccessEvent,
  type UnsignedAccessEvent,
} from "@symcrypt/crypto";
import type { DocumentPurgeRequest } from "@symcrypt/validators/request";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  type DocumentPurgeProofResponse,
  type DocumentPurgeResponse,
  type DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  containerPathRefs,
  readLinkedContainerIdsFromDocumentManifest,
} from "../../data/documents/shared/projection";
import {
  assertDocumentManifestBundleConsistent,
  readManifestContainerId,
  readRecordString,
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
import { loadAccessManifestCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

interface DocumentPurgeApi {
  getDocumentPurgeProof(
    documentId: string,
    options?: { readonly checkpointManifestHashes?: readonly string[] },
  ): Promise<DocumentPurgeProofResponse | null>;
  getDocumentWriterProjectionResult: NonNullable<
    DocumentSyncApi["getDocumentWriterProjectionResult"]
  >;
  purgeDocument(
    documentId: string,
    request: DocumentPurgeRequest,
  ): Promise<DocumentPurgeResponse | null>;
}

const REMOTE_DOCUMENT_ALREADY_PURGED = Symbol("remoteDocumentAlreadyPurged");

async function loadLocalPurgeCheckpointManifestHashes(input: {
  readonly execSql: ExecSql;
  readonly proof: DocumentPurgeProofResponse;
}): Promise<string[]> {
  return Promise.all(
    input.proof.authorizingContainerPath.map(async (bundle, index) => {
      const state = readCanonicalRecord(
        bundle.state,
        `Document purge authorizing container path[${index}] state`,
      );
      const organizationId = readRecordString(
        state,
        "organizationId",
        `Document purge authorizing container path[${index}] state`,
      );
      const containerId = readRecordString(
        state,
        "containerId",
        `Document purge authorizing container path[${index}] state`,
      );
      const checkpoint = await loadAccessManifestCheckpoint(
        input.execSql,
        "container",
        organizationId,
        containerId,
      );
      return checkpoint?.manifestHash ?? bundle.manifestHash;
    }),
  );
}

async function loadCheckpointBoundedDocumentPurgeProof(input: {
  readonly apiClient: Pick<DocumentSyncApi, "getDocumentPurgeProof">;
  readonly documentId: string;
  readonly execSql: ExecSql;
}): Promise<DocumentPurgeProofResponse | null> {
  if (!input.apiClient.getDocumentPurgeProof) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Remote document deletion is missing a purge-proof endpoint",
    );
  }
  const initialProof = await input.apiClient.getDocumentPurgeProof(
    input.documentId,
  );
  if (!initialProof) {
    return null;
  }
  const checkpointManifestHashes = await loadLocalPurgeCheckpointManifestHashes(
    {
      execSql: input.execSql,
      proof: initialProof,
    },
  );
  const initialHeadsMatch = checkpointManifestHashes.every(
    (manifestHash, index) =>
      initialProof.authorizingContainerCheckpointHeads[index]?.manifestHash ===
      manifestHash,
  );
  if (
    initialHeadsMatch &&
    initialProof.authorizingContainerCheckpointHeads.length ===
      checkpointManifestHashes.length
  ) {
    return initialProof;
  }
  return input.apiClient.getDocumentPurgeProof(input.documentId, {
    checkpointManifestHashes,
  });
}

async function resolveDocumentPurgeWriterProjection(input: {
  readonly apiClient: DocumentPurgeApi;
  readonly documentId: string;
}): Promise<
  | DocumentWriterProjectionResponse
  | typeof REMOTE_DOCUMENT_ALREADY_PURGED
  | null
> {
  const result = await input.apiClient.getDocumentWriterProjectionResult(
    input.documentId,
    { reportErrors: false },
  );
  if (result.ok) {
    return result.data;
  }
  if (result.status === 404 && result.code === DOCUMENT_NOT_FOUND_ERROR_CODE) {
    return REMOTE_DOCUMENT_ALREADY_PURGED;
  }
  result.report();
  return null;
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
    | ((input: {
        readonly commitPurgeProof: (
          transactionExecSql: ExecSql,
        ) => Promise<void>;
        readonly documentId: string;
      }) => Promise<void> | void)
    | undefined;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): (deleted: { readonly documentId: string }) => Promise<void> {
  return async ({ documentId }) => {
    const proof = await loadCheckpointBoundedDocumentPurgeProof({
      apiClient: input.apiClient,
      documentId,
      execSql: input.execSql,
    });
    if (!proof) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Remote document deletion is missing its signed purge proof",
      );
    }
    const verified = await verifyDocumentPurgeProof({
      execSql: input.execSql,
      expectedDocumentId: documentId,
      proof,
      resolveUserKey: input.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    if (input.onVerifiedDeletion) {
      await input.onVerifiedDeletion({
        commitPurgeProof: verified.commitCheckpoints,
        documentId,
      });
      return;
    }
    await verified.commitCheckpoints(input.execSql);
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
  const verified = await verifyDocumentPurgeProof({
    execSql: input.execSql,
    expectedDocumentId: input.documentId,
    proof: input.proof,
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  await verified.commitCheckpoints(input.execSql);
}

export async function purgeRemoteDocument(input: {
  readonly apiClient: DocumentPurgeApi;
  readonly author: DocumentCreateAuthor;
  readonly documentId: string;
  readonly execSql: ExecSql;
  readonly onVerifiedPurge?:
    | ((input: {
        readonly commitPurgeProof: (
          transactionExecSql: ExecSql,
        ) => Promise<void>;
      }) => Promise<void> | void)
    | undefined;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}): Promise<DocumentPurgeResponse | null> {
  const writerProjection = await resolveDocumentPurgeWriterProjection({
    apiClient: input.apiClient,
    documentId: input.documentId,
  });
  if (!writerProjection) {
    return null;
  }
  if (writerProjection === REMOTE_DOCUMENT_ALREADY_PURGED) {
    const proof = await loadCheckpointBoundedDocumentPurgeProof({
      apiClient: input.apiClient,
      documentId: input.documentId,
      execSql: input.execSql,
    });
    if (!proof) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Purged remote document is missing its signed purge proof",
      );
    }
    const verified = await verifyDocumentPurgeProof({
      execSql: input.execSql,
      expectedDocumentId: input.documentId,
      proof,
      resolveUserKey: input.resolveProjectionUserKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    if (input.onVerifiedPurge) {
      await input.onVerifiedPurge({
        commitPurgeProof: verified.commitCheckpoints,
      });
    } else {
      await verified.commitCheckpoints(input.execSql);
    }
    return { ...proof, reclaimedBlobStorageKeys: [] };
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
  const verified = await verifyDocumentPurgeProof({
    execSql: input.execSql,
    expectedDocumentId: input.documentId,
    proof: response,
    resolveUserKey: input.resolveProjectionUserKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  if (input.onVerifiedPurge) {
    await input.onVerifiedPurge({
      commitPurgeProof: verified.commitCheckpoints,
    });
  } else {
    await verified.commitCheckpoints(input.execSql);
  }
  return response;
}
