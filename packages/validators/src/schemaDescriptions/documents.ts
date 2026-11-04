import { describeSchema } from "../jsonSchemaAnnotations";
import {
  DocumentContentKeyBundleRequestSchema,
  DocumentContentKeyTargetEnvelopeSchema,
  DocumentCreateRequestSchema,
  DocumentLinkSetMutationRequestSchema,
  DocumentOutgoingUpdateSchema,
  DocumentPurgeRequestSchema,
  DocumentSyncRequestSchema,
} from "../request";
import {
  DocumentContentKeyBundleResponseSchema,
  DocumentContentKeyTargetEnvelopeResponseSchema,
  DocumentCreateResponseSchema,
  DocumentEditAttributionResponseSchema,
  DocumentEditAttributionSegmentResponseSchema,
  DocumentKekTargetsResponseSchema,
  DocumentLinkSetMutationResponseSchema,
  DocumentMutationErrorCodeSchema,
  DocumentMutationFailureResponseSchema,
  DocumentNotFoundErrorResponseSchema,
  DocumentPurgeProofResponseSchema,
  DocumentPurgeResponseSchema,
  DocumentSyncErrorResponseSchema,
  DocumentSyncPullPageResponseSchema,
  DocumentSyncResponseSchema,
  DocumentSyncUpdateResponseSchema,
  DocumentWriterProjectionErrorResponseSchema,
  DocumentWriterProjectionWireResponseSchema,
} from "../response";

describeSchema(
  DocumentContentKeyTargetEnvelopeSchema,
  "A document content key wrapped to one container KEK.",
  {
    containerKeyEpochId: "Id of the container KEK epoch that wraps the key.",
    containerManifestHash: "Container manifest head the wrap was made under.",
    wrappedKey: "The content key encrypted under the container KEK.",
    wrappingMetadata: "Wrapping suite and IV needed to unwrap `wrappedKey`.",
  },
);

describeSchema(
  DocumentContentKeyTargetEnvelopeResponseSchema,
  "A stored wrap of a document content key to one container KEK.",
  {
    containerKeyEpochId: "Id of the container KEK epoch that wraps the key.",
    containerManifestHash: "Container manifest head the wrap was made under.",
    wrappedKey: "The content key encrypted under the container KEK.",
    wrappingMetadata: "Wrapping suite and IV needed to unwrap `wrappedKey`.",
  },
);

describeSchema(
  DocumentContentKeyBundleRequestSchema,
  "A content-key bundle: one document content-key epoch wrapped to every linked container's KEK.",
  {
    linkSetManifestHash:
      "Document link-set manifest the targets were derived from.",
    targetHash:
      "Target hash the wraps must match; the API derives it from verified access state.",
  },
);

describeSchema(
  DocumentContentKeyBundleResponseSchema,
  "A stored content-key bundle for one document content-key epoch.",
  {
    linkSetManifestHash:
      "Document link-set manifest the targets were derived from.",
    targetHash: "Hash of the key target set the wraps cover.",
  },
);

describeSchema(
  DocumentKekTargetsResponseSchema,
  "The key targets the API derived for a document from its link set: one per linked container KEK.",
  {
    documentKeyTargetHash:
      "Hash of the derived target set; write headers and bundles must match it.",
    linkedContainerKeyEpochIds: "Current KEK epochs of the linked containers.",
    linkedContainerManifestHashes:
      "Current manifest heads of the linked containers.",
  },
);

describeSchema(
  DocumentOutgoingUpdateSchema,
  "One encrypted Loro update a client uploads, with its signed write header.",
  {
    checkpointKind:
      "`rotate_baseline` when the update is a rotation baseline; absent for an ordinary update.",
    checkpointPayloadKind:
      "`full_history_snapshot` for a rotation baseline; absent otherwise.",
    encryptedData:
      "Base64 ciphertext of the update under the document content key.",
    id: "Client-chosen update id; a retry with the same id is accepted only if the ciphertext and header are identical.",
    partialEndVersionVector:
      "Version vector the update brings the document to.",
    partialStartVersionVector: "Version vector the update starts from.",
    plaintextHash:
      "Hash of the plaintext update, committed by the write header.",
    sourceVersionVector:
      "For a rotation baseline, the frontier its snapshot covers.",
    writeHeader:
      "Signed write header binding the ciphertext to the document, access manifest, content-key epoch, target hash, and writer.",
  },
);

describeSchema(
  DocumentSyncRequestSchema,
  "A document sync: uploads encrypted updates and asks for the ones the client is missing, one page at a time.",
  {
    authorizingContainerPathRefs:
      "Container paths that authorize a write; reads may omit them.",
    containerRekeys:
      "Container rekeys to commit first in the same transaction.",
    contentKeyBundle:
      "A new content-key bundle, when the write advances the content-key epoch.",
    contentKeyEpoch: "Content-key epoch the client is writing and reading at.",
    expectedLinkSetManifestHash:
      "The document link-set manifest head the client planned against; a different current head is refused as stale.",
    expectedTargetHash: "The key target hash the client planned against.",
    historyMode:
      "`raw` asks for every retained update missing from the frontier, bypassing rotation baselines; read-only.",
    inlineRekeyCommitId:
      "Marker that makes carried rekeys and the write replay-safe as one transaction; present exactly when `containerRekeys` is non-empty.",
    localVersionVector:
      "The client's current version vector; the response returns updates it does not cover.",
    minLsn:
      "Commit LSN the server must have reached before answering, for read-after-write consistency.",
    outgoingUpdates: "Encrypted updates to upload.",
    pullCursor:
      "Continuation cursor from the previous page; a continuation is read-only.",
    supportsPullPagination: "Always true; every response is paged.",
  },
);

describeSchema(
  DocumentSyncUpdateResponseSchema,
  "One stored encrypted update returned by a sync.",
  {
    accessEpoch: "Content-key epoch the update was written at.",
    authorizationTargets:
      "Container KEK targets the write was authorized against.",
    authorFingerprint: "Signing key fingerprint of the writer.",
    checkpointKind: "`rotate_baseline` when the update is a rotation baseline.",
    checkpointPayloadKind: "`full_history_snapshot` for a rotation baseline.",
    encryptedData: "Base64 ciphertext of the update.",
    partialEndVersionVector:
      "Version vector the update brings the document to.",
    partialStartVersionVector: "Version vector the update starts from.",
    plaintextHash:
      "Hash of the plaintext update, committed by the write header.",
    sourceVersionVector:
      "For a rotation baseline, the frontier its snapshot covers.",
    writeHeader: "The update's signed write header.",
  },
);

describeSchema(
  DocumentSyncPullPageResponseSchema,
  "Whether more updates remain in this pull.",
  {
    hasMore: "True exactly when `nextCursor` is set.",
    nextCursor:
      "Opaque cursor for the next page, or null on the last page; it grants nothing, and each page is reauthorized.",
  },
);

describeSchema(
  DocumentSyncResponseSchema,
  "The result of a sync: which uploads were accepted, one page of missing updates, and the key material to decrypt them.",
  {
    acceptedOutgoingUpdateIds:
      "Ids of uploaded updates that are now committed.",
    commitLsn:
      "Commit LSN after the request; pass it as `minLsn` to read your own writes from a replica.",
    commitLsnMode:
      "`tracked` for a durable backend position; `untracked` with the `0/0` sentinel when the backend cannot report one.",
    contentKeyBundle: "Content-key bundle of the current epoch.",
    contentKeyBundles:
      "Bundles of older epochs that this page's updates were written at; never the current epoch.",
    documentKekTargets: "The document's current key targets.",
    updates: "Encrypted updates the client's version vector does not cover.",
  },
);

describeSchema(
  DocumentSyncErrorResponseSchema,
  "A refused sync. The code tells the client what to do: regenerate a rotation checkpoint, commit rekeys first, replan, recover update ids, or stop.",
  {
    principalHeads:
      "With `document_sync_state_stale` from a carried rekey, up to 16 current principal heads to recover before replanning; advisory only.",
  },
);

describeSchema(
  DocumentNotFoundErrorResponseSchema,
  "The document does not exist; clients treat only this coded 404 as deletion.",
);

describeSchema(
  DocumentCreateRequestSchema,
  "A signed document create: the document's first link-set manifest, its content-key bundle, and optionally its first encrypted update.",
  {
    initialSync:
      "The document's first queued update, committed in the create transaction under every check a sync makes.",
  },
);

describeSchema(
  DocumentCreateResponseSchema,
  "Acknowledges a document create by hash.",
  {
    contentKeyEpoch: "Content-key epoch the API stored.",
    eventHash: "Hash of the signed event.",
    manifestHash: "Hash of the committed document link-set manifest.",
    targetHash: "Key target hash the API derived.",
    initialSync:
      "Present exactly when the request carried a seed; names the accepted update and its commit position.",
  },
);

describeSchema(
  DocumentLinkSetMutationRequestSchema,
  "A signed `document.link` or `document.unlink` that changes the containers a document is linked into.",
  {
    authorizingContainerPathRefs:
      "Paths through which the caller may write the document now.",
    containerRekeys:
      "Container rekeys to commit first in the same transaction.",
    contentKeyBundle: "Content-key bundle for the new link set's targets.",
    expectedManifestHash:
      "Hash of the link-set manifest this mutation derives.",
    rotationBaseline:
      "For an unlink, a rotation baseline covering every committed update; omitted only when the document has none, and never sent with a link.",
    targetContainerPathRefs: "Path to the container being linked or unlinked.",
  },
);

describeSchema(
  DocumentLinkSetMutationResponseSchema,
  "Acknowledges a link or unlink by hash.",
  {
    manifestHash: "Hash of the new document link-set manifest head.",
    targetHash: "Key target hash the API derived for the new link set.",
  },
);

describeSchema(
  DocumentMutationErrorCodeSchema,
  "A machine-readable reason a document mutation was refused.",
);

describeSchema(
  DocumentMutationFailureResponseSchema,
  "A refused document create, link, unlink, or purge.",
);

describeSchema(
  DocumentPurgeRequestSchema,
  "A signed `document.purge` citing the exact current path that authorizes it.",
  {
    authorizingContainerPathRefs:
      "Root-to-container path of the document's only linked container.",
  },
);

describeSchema(
  DocumentPurgeProofResponseSchema,
  "The signed proof that a document was purged, with the manifests and policy history a client needs to verify it.",
  {
    authorizingContainerPath: "Container path that authorized the purge.",
    documentManifest: "The document's last link-set manifest.",
    documentManifestPredecessors: "Earlier link-set manifests of the document.",
    purgeEvent: "The signed `document.purge` event.",
  },
);

describeSchema(
  DocumentPurgeResponseSchema,
  "The purge proof. Blobs only this document referenced are soft-deleted and reclaimed later by garbage collection.",
  {
    reclaimedBlobStorageKeys:
      "Object-store keys reclaimed during the request; currently always empty, because reclamation is deferred.",
  },
);

describeSchema(
  DocumentWriterProjectionWireResponseSchema,
  "A document writer projection: its link-set history, authorizing container paths with KEK levels, and key targets. Every manifest is carried once in `bundles` and cited by hash.",
  {
    bundles: "Signed manifest bundles keyed by manifest hash.",
    omittedBundles:
      "Cited hashes left out because the request said the client holds them.",
    authorizingContainerPaths:
      "Each linked container's path from the root, with one KEK level per manifest.",
    contentKeyBundleStale:
      "Present only when the stored content-key bundle targets superseded KEKs and must be rewrapped.",
    documentManifest: "Hash of the current document link-set manifest.",
    documentManifestHistory: "Hashes of earlier document link-set manifests.",
    policyEvidence:
      "Public principal policy history the cited manifests depend on.",
  },
);

describeSchema(
  DocumentWriterProjectionErrorResponseSchema,
  "A refused document writer projection; a missing container is reported as a conflict, never as the document's absence.",
);

describeSchema(
  DocumentEditAttributionSegmentResponseSchema,
  "A run of Loro operations attributed to the writer of the earliest signed update that delivered them.",
  {
    authorityKind:
      "`direct` when the earliest update that delivered the run is an ordinary update, whose writer is the first uploader rather than proven author; `baseline` when it is a rotation baseline, which only re-asserts existing operations.",
    endCounter: "End of the run in the peer's operation counter.",
    peerId: "Loro peer id of the writing device.",
    startCounter: "Start of the run in the peer's operation counter.",
    writerKeyFingerprint:
      "Signing key fingerprint from the update's write header.",
  },
);

// DocumentEditAttributionRangeResponse is deliberately undescribed: it sits inside an inline anyOf/oneOf
// branch of ListDocumentEditAttributionRangesResponse, and the pinned oasdiff reports any description change
// in such a branch's resolved subtree as a breaking branch replacement.

describeSchema(
  DocumentEditAttributionResponseSchema,
  "Who first uploaded each part of a document, as compact runs derived from the signed write headers of its updates.",
  {
    attributionRevision: "Changes whenever new updates change the attribution.",
    truncated:
      "True when the run list hit the response limit; page the rest through the ranges route.",
  },
);
