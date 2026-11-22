import type { BlobAttachmentDetachRequest } from "@tearleads/validators/request";
import {
  type BlobAttachmentCollaborators,
  requireEncapsulationSecretKey,
} from "../../data/blobs/attachments/collaborators";
import { signBlobAttachmentDetachEvent } from "../../data/blobs/attachments/events";
import { assertBlobAttachmentDetachResponse } from "../../data/blobs/attachments/responses";
import type {
  DecryptDocumentAttachmentBlobRequest,
  DetachDocumentAttachmentRequest,
  DetachDocumentAttachmentResult,
  UploadDocumentAttachmentRequest,
  UploadDocumentAttachmentResult,
} from "../../data/blobs/attachments/types";
import type { BlobBytes } from "../../data/blobs/blobContracts";
import { authorizingContainerPathRefs } from "../../data/documents/shared/projection";
import { readCanonicalRecord } from "../../data/keying/canonicalJson";
import { requireProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { decryptDocumentAttachmentBlob } from "./hydration/decrypt";
import type { ExpectedDownloadSizes } from "./hydration/expectedDownloadSizes";
import {
  type HydrateDocumentAttachmentBlobsRequest,
  type HydratedDocumentAttachmentBlob,
  hydrateDocumentAttachmentBlobs,
} from "./hydration/hydrate";
import {
  type PreparedUploadDocumentAttachmentRequest,
  uploadPreparedDocumentAttachment,
} from "./upload";
import { resolveBlobMutationWriterProjection } from "./verification/writerProjection";

let collaboratorsOf: (
  service: BlobAttachmentService,
) => BlobAttachmentCollaborators;

/**
 * Client Blob Storage: uploads, detaches, hydrates, and decrypts document
 * attachment blobs. One instance binds the API client, executor, and key
 * material of one documents runtime snapshot; each request carries what varies
 * per call, such as ids, the projection key resolver, and currency checks.
 */
export class BlobAttachmentService {
  private readonly blobs: BlobAttachmentCollaborators;
  private readonly expectedDownloads: ExpectedDownloadSizes | undefined;

  static {
    collaboratorsOf = (service) => service.blobs;
  }

  constructor(
    collaborators: BlobAttachmentCollaborators,
    expectedDownloads?: Omit<ExpectedDownloadSizes, "signal"> & {
      signal?: AbortSignal | undefined;
    },
  ) {
    if (expectedDownloads && !collaborators.api.supportsBoundedAttachmentReads)
      throw new Error(
        "This transport does not support bounded attachment reads.",
      );
    this.blobs = collaborators;
    // A signal selects the bounded reader for every read, so one is always set.
    this.expectedDownloads = expectedDownloads && {
      ...expectedDownloads,
      signal: expectedDownloads.signal ?? new AbortController().signal,
    };
  }

  /** Limit this document's hydration to known slot sizes before reading any body. */
  withExpectedDownloads(
    documentId: string,
    sizesBySlot: ReadonlyMap<string, number>,
    signal?: AbortSignal,
    onVerifiedBinding?: ExpectedDownloadSizes["onVerifiedBinding"],
  ): BlobAttachmentService {
    return new BlobAttachmentService(this.blobs, {
      documentId,
      sizesBySlot: new Map(sizesBySlot),
      onVerifiedBinding,
      signal,
    });
  }

  /** Inspects the source itself; any `sourceSnapshot` a caller attaches is dropped. */
  uploadDocumentAttachment(
    request: UploadDocumentAttachmentRequest,
  ): Promise<UploadDocumentAttachmentResult | null> {
    return uploadPreparedDocumentAttachment(this.blobs, {
      ...request,
      sourceSnapshot: undefined,
    });
  }

  async detachDocumentAttachment({
    author,
    bindingId,
    blobId,
    documentId,
    eventId = crypto.randomUUID(),
    isRemoteSyncBlocked,
    resolveProjectionUserKey,
    signedAt = new Date().toISOString(),
    slotId,
    stillCurrent,
    warmReferencedPrincipalPolicies,
    writerProjection,
  }: DetachDocumentAttachmentRequest): Promise<DetachDocumentAttachmentResult | null> {
    const resolved = await resolveBlobMutationWriterProjection({
      apiClient: this.blobs.api,
      documentId,
      errorLabel: "Blob attachment detach",
      execSql: this.blobs.execSql,
      isRemoteSyncBlocked,
      stillCurrent,
      warmReferencedPrincipalPolicies,
      resolveProjectionUserKey: requireProjectionUserKeyResolver(
        resolveProjectionUserKey,
        "Document attachment detach",
      ),
      writerProjection,
    });
    if (!resolved) {
      return null;
    }
    const { manifestIdentity, writerProjection: resolvedWriterProjection } =
      resolved;

    const pathRefs = authorizingContainerPathRefs(resolvedWriterProjection);
    const { body, event } = await signBlobAttachmentDetachEvent({
      author,
      bindingId,
      blobId,
      documentId,
      eventId,
      manifestIdentity,
      signedAt,
      slotId,
      authorizingContainerPathRefs: pathRefs,
    });
    const request: BlobAttachmentDetachRequest = {
      event: readCanonicalRecord(event, "Blob attachment detach event"),
      body: readCanonicalRecord(body, "Blob attachment detach body"),
      authorizingContainerPathRefs: pathRefs,
    };
    assertProjectionVerificationCurrent(stillCurrent);
    const response = await this.blobs.api.detachBlobAttachment(
      blobId,
      bindingId,
      request,
      {
        expectedPaymentRequiredOrganizationId: manifestIdentity.organizationId,
        stillCurrent,
      },
    );
    if (!response) {
      return null;
    }
    assertProjectionVerificationCurrent(stillCurrent);

    assertBlobAttachmentDetachResponse({
      bindingId,
      blobId,
      documentId,
      response,
      slotId,
    });

    return {
      request,
      response,
      writerProjection: resolvedWriterProjection,
    };
  }

  hydrateDocumentAttachmentBlobs(
    request: HydrateDocumentAttachmentBlobsRequest,
  ): Promise<HydratedDocumentAttachmentBlob[] | null> {
    return hydrateDocumentAttachmentBlobs(
      this.blobs,
      request,
      this.expectedDownloads,
    );
  }

  decryptDocumentAttachmentBlob(
    request: DecryptDocumentAttachmentBlobRequest,
  ): Promise<BlobBytes> {
    return decryptDocumentAttachmentBlob({
      ...request,
      execSql: this.blobs.execSql,
      targetSecretKey: requireEncapsulationSecretKey(
        this.blobs,
        "Document attachment blob decrypt",
      ),
    });
  }
}

/**
 * Uploads a source that `inspectBlobSource` snapshotted, through a service's
 * collaborators. Document stores only: the snapshot is trusted to describe the
 * bytes, and pairing it with other bytes could reuse AES-GCM nonces, so this
 * stays off the class and out of the package root.
 */
export function uploadInspectedDocumentAttachment(
  service: BlobAttachmentService,
  request: PreparedUploadDocumentAttachmentRequest,
): Promise<UploadDocumentAttachmentResult | null> {
  return uploadPreparedDocumentAttachment(collaboratorsOf(service), request);
}
