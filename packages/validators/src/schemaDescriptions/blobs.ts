import { describeSchema } from "../jsonSchemaAnnotations";
import {
  BlobAttachmentBindRequestSchema,
  BlobAttachmentDetachRequestSchema,
  BlobContentKeyBundleRequestSchema,
  BlobContentKeyTargetEnvelopeRequestSchema,
  BlobStagedBlobRequestSchema,
  ContainerManifestRefArrayArraySchema,
  ContainerManifestRefSchema,
  InitiateMultipartBlobStageRequestSchema,
  PrincipalPolicyRefListSchema,
  PrincipalPolicyRefSchema,
} from "../request";
import {
  BlobAttachmentBindResponseSchema,
  BlobAttachmentDetachResponseSchema,
  BlobAttachmentSummarySchema,
  BlobContentKeyBundleResponseSchema,
  BlobContentKeyTargetEnvelopeResponseSchema,
  BlobKekTargetsResponseSchema,
  BlobMutationFailureResponseSchema,
  InitiateMultipartBlobStageResponseSchema,
  ListDocumentAttachmentsResponseSchema,
  MultipartBlobStageConflictErrorResponseSchema,
  MultipartBlobStageNotFoundErrorResponseSchema,
  MultipartBlobStagePartSchema,
  MultipartBlobStageStatusResponseSchema,
  SyncWatermarkSchema,
  UploadMultipartBlobPartResponseSchema,
} from "../response";
import {
  AccessEventBundleWireResponseSchema,
  AccessManifestBundleWireResponseSchema,
  MultipartBlobPartDescriptorSchema,
  MultipartBlobPartUploadSchema,
  MultipartBlobPartUploadSourceSchema,
} from "../util";

describeSchema(
  AccessEventBundleWireResponseSchema,
  "A signed access event as stored: the event, its typed body, and its hash, which clients verify before trusting.",
  {
    body: "Event-type-specific body the signature commits to.",
    eventHash: "Hash of the canonical signed event.",
  },
);

describeSchema(
  AccessManifestBundleWireResponseSchema,
  "A signed access manifest with the event that produced it, exactly as the API stores it.",
  {
    manifestHash:
      "Hash of the canonical manifest; other responses cite the manifest by this value.",
    state: "Derived structural state the manifest commits to.",
  },
);

describeSchema(
  ContainerManifestRefSchema,
  "Cites a container access manifest the API already stores, instead of resending the signed bundle.",
  {
    containerId:
      "Advisory; the API keys the lookup off the stored bundle's own container and rejects a mismatch.",
    manifestHash:
      "Hash of the cited manifest. Path and previous-manifest citations must name current heads; history citations name earlier manifests.",
  },
);

describeSchema(
  ContainerManifestRefArrayArraySchema,
  "A list of authorizing container paths, each a root-to-leaf chain of container manifest citations.",
);

describeSchema(
  SyncWatermarkSchema,
  "The last row a listing page returned, by update time and id; the next page starts after it.",
);

describeSchema(
  PrincipalPolicyRefSchema,
  "Cites the principal policy head a mutation was planned against, instead of resending the signed policy; the API refuses it as stale unless it is the current head.",
  {
    stateHash:
      "Hash of the signed state, which commits to its membership projection and grants.",
  },
);

describeSchema(
  PrincipalPolicyRefListSchema,
  "The principal policy heads a container mutation was planned against.",
);

describeSchema(
  InitiateMultipartBlobStageRequestSchema,
  "Opens a blob stage for one encrypted object.",
  {
    organizationId:
      "Organization the blob will belong to; it must match the destination document's organization at bind time.",
    byteLength: "Exact size of the complete encrypted object.",
    sha256:
      "SHA-256 of the complete encrypted object, checked when the bind assembles it.",
    firstParts:
      "The one to four parts the client sends first, so the response can carry their upload sources.",
  },
);

describeSchema(
  InitiateMultipartBlobStageResponseSchema,
  "A new blob stage and the upload sources for its first parts.",
  {
    expiresAt:
      "When the stage expires; an attachment bind must complete it before then.",
    partUploads:
      "One upload source per requested first part, in request order.",
    uploadId:
      "Object-store multipart upload id; later part authorizations name it.",
    uploadedParts: "Parts already uploaded.",
  },
);

describeSchema(
  MultipartBlobStageStatusResponseSchema,
  "A blob stage's progress, used to resume an interrupted upload.",
  {
    completed:
      "True once an attachment bind assembled and verified the object.",
    uploadedParts: "Parts uploaded so far, with their ETags.",
  },
);

describeSchema(
  MultipartBlobStagePartSchema,
  "One uploaded part of a blob stage.",
  { etag: "Object-store ETag confirming the part's bytes." },
);

describeSchema(
  MultipartBlobPartDescriptorSchema,
  "One encrypted part as the client will send it.",
  {
    contentMd5:
      "Base64 MD5 of the part's bytes; a signed upload URL is bound to it.",
  },
);

describeSchema(
  MultipartBlobPartUploadSchema,
  "One part's descriptor and where to send its bytes.",
);

describeSchema(
  MultipartBlobPartUploadSourceSchema,
  "Where a part's bytes go: the API byte route (`kind: api`) for stores that cannot sign, or a short-lived URL that accepts exactly this part.",
);

describeSchema(
  UploadMultipartBlobPartResponseSchema,
  "Confirms a part uploaded through the API byte route.",
);

describeSchema(
  BlobStagedBlobRequestSchema,
  "Names the blob stage an attachment bind completes, with the blob's signed write header.",
  {
    writeHeader:
      "Signed write header committing to the blob id, access manifest, content-key epoch, target hash, and ciphertext hash.",
  },
);

describeSchema(
  BlobContentKeyTargetEnvelopeRequestSchema,
  "The blob content key wrapped to one container KEK for one attachment binding.",
  {
    containerKeyEpoch: "Epoch of the container KEK that wraps the key.",
    containerKeyEpochId: "Id of that container KEK epoch.",
    containerManifestHash: "Container manifest head the wrap was made under.",
    wrappedKey: "The content key encrypted under the container KEK.",
    wrappingMetadata: "Wrapping suite and IV needed to unwrap `wrappedKey`.",
  },
);

describeSchema(
  BlobContentKeyTargetEnvelopeResponseSchema,
  "A stored wrap of a blob content key to one container KEK for one attachment binding.",
  {
    containerKeyEpochId: "Id of the container KEK epoch that wraps the key.",
    containerManifestHash: "Container manifest head the wrap was made under.",
    wrappedKey: "The content key encrypted under the container KEK.",
    wrappingMetadata: "Wrapping suite and IV needed to unwrap `wrappedKey`.",
  },
);

describeSchema(
  BlobContentKeyBundleRequestSchema,
  "A blob content-key bundle: the blob content key wrapped to every container KEK target of the new binding.",
  {
    targetHash:
      "Target hash the wraps must match; the API derives it from verified access state.",
  },
);

describeSchema(
  BlobContentKeyBundleResponseSchema,
  "A blob content-key bundle: the blob content key wrapped to the container KEKs of its active attachment bindings.",
  { targetHash: "Hash of the key target set the wraps cover." },
);

describeSchema(
  BlobKekTargetsResponseSchema,
  "The key targets the API derived for a blob from its active attachment bindings and their documents' linked containers.",
  {
    activeBindingIds: "Attachment bindings currently referencing the blob.",
    blobAccessManifestHash:
      "Access manifest hash the blob's writes are bound to.",
    blobKeyTargetHash: "Hash of the derived target set.",
    linkedContainerKeyEpochIds:
      "Current container KEK epochs of the linked containers.",
  },
);

describeSchema(
  BlobAttachmentBindRequestSchema,
  "A signed `attachment.bind`: puts a blob in a document slot, optionally completing a blob stage and committing the document's first update.",
  {
    authorizingContainerPathRefs:
      "Container paths that authorize the write; the API resolves the document link-set manifest itself.",
    body: "Signed bind body naming the binding, blob, document, slot, replaced binding, and document manifest hash.",
    containerRekeys:
      "Container rekeys to commit first in the same transaction.",
    documentSync:
      "The document's first queued update, committed with the bind under every check a standalone sync makes.",
    stagedBlob:
      "The blob stage to promote; absent when binding a blob that is already committed.",
  },
);

describeSchema(
  BlobAttachmentBindResponseSchema,
  "Acknowledges a bind by hash, so the client can compare it with what it signed.",
  {
    contentKeyEpoch: "Content-key epoch the API stored for the blob.",
    documentManifestHash:
      "Document link-set manifest head the bind was checked against.",
    eventHash: "Hash of the signed bind event.",
    previousBindingId: "Binding this one replaced in the slot, or null.",
    writeHeaderHash: "Hash of the stored blob write header.",
    documentSync:
      "Present exactly when the request carried `documentSync`; names the accepted update.",
  },
);

describeSchema(
  BlobAttachmentDetachRequestSchema,
  "A signed `attachment.detach` that removes an active binding from its slot.",
  {
    authorizingContainerPathRefs: "Container paths that authorize the write.",
    containerRekeys:
      "Container rekeys to commit first in the same transaction.",
  },
);

describeSchema(
  BlobAttachmentDetachResponseSchema,
  "Confirms which binding was detached.",
);

describeSchema(
  BlobAttachmentSummarySchema,
  "One active attachment binding with everything a reader needs to verify and decrypt its blob.",
  {
    bindingEvent: "The signed `attachment.bind` event.",
    documentManifestHash:
      "Document link-set manifest head the binding was made under.",
    previousBindingId: "Binding this one replaced, or null.",
    writeAuthorization: "Key targets the blob's write was authorized against.",
    writeHeader: "The blob's signed write header.",
  },
);

describeSchema(
  ListDocumentAttachmentsResponseSchema,
  "A document's active attachment bindings.",
);

describeSchema(
  BlobMutationFailureResponseSchema,
  "A refused attachment bind or detach.",
  {
    code: "`container_unavailable` when a container the write depends on no longer exists.",
  },
);

describeSchema(
  MultipartBlobStageNotFoundErrorResponseSchema,
  "The blob stage, its upload, or its staged object no longer exists; only this coded 404 permits starting a fresh stage.",
);

describeSchema(
  MultipartBlobStageConflictErrorResponseSchema,
  "A 409 for a blob stage.",
  {
    code: "`multipart_blob_stage_expired` when the stage expired, which permits starting a fresh one; uncoded conflicts are terminal.",
  },
);
