import { describeSchema } from "../jsonSchemaAnnotations";
import {
  ContainerCreateWithMetadataDocumentRequestSchema,
  ContainerMutationRequestSchema,
  ContainerReciteRequestSchema,
  ContainerRotationRequestSchema,
  ListContainerDocumentLanesRequestSchema,
  ListContainerParentLanesRequestSchema,
} from "../request";
import {
  CitedContainerKekLevelSchema,
  ContainerCreateWithMetadataDocumentResponseSchema,
  ContainerDeleteResponseSchema,
  ContainerDocumentSummaryResponseSchema,
  ContainerDocumentSyncTombstoneResponseSchema,
  ContainerKekLogEpochResponseSchema,
  ContainerKekLogResponseSchema,
  ContainerMutationErrorCodeSchema,
  ContainerMutationFailureResponseSchema,
  ContainerMutationResponseSchema,
  ContainerNotFoundErrorResponseSchema,
  ContainerReciteResponseSchema,
  ContainerRotationResponseSchema,
  ContainerSummaryResponseSchema,
  ContainerSyncTombstoneResponseSchema,
  ContainerWriterProjectionErrorResponseSchema,
  ContainerWriterProjectionWireResponseSchema,
  ListContainerDocumentsResponseSchema,
  ListContainerParentLanesResponseSchema,
  ListContainersResponseSchema,
  ListDocumentEditAttributionRangesResponseSchema,
} from "../response";
import { ContainerKekKeyringWireRecordSchema } from "../util";

describeSchema(
  ContainerMutationRequestSchema,
  "A signed container mutation (create, share, or the container part of a larger write): the event, the manifest it derives, and the KEK material, citing stored heads instead of resending them.",
  {
    body: "Event-type-specific body the signature commits to.",
    containerManifestHistoryRefs:
      "Earlier manifests of this container the verifier needs, cited by hash.",
    destinationParentContainerPathRefs:
      "Current path to the new parent, for a move.",
    expectedManifestHash:
      "Hash of the manifest this mutation derives; the API derives it independently and must agree.",
    keyEpoch: "The container KEK epoch this mutation leaves current.",
    keyring:
      "For a KEK rotation, every predecessor KEK sealed under the new KEK; null otherwise.",
    parentContainerPathRefs: "Current path to the parent container.",
    parentKekRef:
      "The parent's current KEK epoch, for a child container; any other epoch is refused as stale.",
    predecessorBridge:
      "For a KEK rotation, the retiring KEK encrypted under the new one; null otherwise.",
    previousContainerPathRefs:
      "Current path to the mutated container, from its root.",
    previousManifestRef:
      "The container's current manifest head; absent for a create.",
    principalPolicyRefs:
      "Heads of the principal policies the mutation was planned against.",
    userRecipientKeys:
      "Public keys of users the container KEK is wrapped to directly.",
    wraps: "The container KEK wrapped to each derived recipient target.",
  },
);

describeSchema(
  ContainerRotationRequestSchema,
  "A rekey, revoke, or move, which rotates the container KEK, plus the descendant rekeys that must commit with it.",
  {
    containerRekeys:
      "Descendant rekeys, parent first; they commit with the rotation or not at all.",
  },
);

describeSchema(
  ContainerReciteRequestSchema,
  "A signed `container.recite` that advances a container's manifest to cite its ancestors' current heads, changing nothing else.",
  {
    expectedManifestHash: "Hash of the manifest this re-citation derives.",
    previousContainerPathRefs: "The container's current path, from its root.",
    previousManifestRef: "The container's current manifest head.",
    principalPolicyRefs:
      "Heads of the principal policies the re-citation was planned against.",
  },
);

describeSchema(
  ContainerMutationResponseSchema,
  "Acknowledges a container mutation by hash; the client compares each value with the plan it signed and refuses any mismatch.",
  {
    eventHash: "Hash of the signed event the API stored.",
    manifestHead: "Epoch and hash of the container's new manifest head.",
    containerKek: "Identity and hashes of the container's current KEK epoch.",
    systemSlot:
      "Opaque id of a system container's role, or null for an ordinary container.",
  },
);

describeSchema(
  ContainerRotationResponseSchema,
  "Acknowledges a rotation, plus one acknowledgement per carried descendant rekey in request order.",
);

describeSchema(
  ContainerReciteResponseSchema,
  "Acknowledges a re-citation by its event hash and new manifest head; keys are unchanged.",
);

describeSchema(
  ContainerCreateWithMetadataDocumentRequestSchema,
  "Creates a container together with its encrypted metadata document.",
  {
    initialMetadataSync:
      "The metadata document's first queued update, committed in the same transaction.",
  },
);

describeSchema(
  ContainerCreateWithMetadataDocumentResponseSchema,
  "Acknowledges a container and its metadata document.",
);

describeSchema(ContainerDeleteResponseSchema, "Confirms a container deletion.");

describeSchema(
  ContainerSummaryResponseSchema,
  "One container in a listing, with the caller's effective access to it.",
  {
    depth:
      "Position in the container tree, counted from the organization's root container.",
    effectiveAccessLevel:
      "The caller's access, derived from signed grants along the container path.",
    metadataAccessEpoch: "Access epoch of the container's metadata document.",
    metadataAccessStateHash: "Access state hash of the metadata document.",
    metadataDocumentId:
      "Encrypted document that holds the container's name and other metadata.",
    metadataReferencedPrincipals:
      "Principal policy heads the metadata document's access depends on.",
    systemSlot:
      "Opaque id of a system container's role, such as Trash, or null for an ordinary container.",
  },
);

describeSchema(
  ContainerSyncTombstoneResponseSchema,
  "A container that left the caller's view since the last listing page.",
  {
    reason:
      "`deleted` when the container was deleted; `access_revoked` when the caller lost access.",
  },
);

describeSchema(
  ListContainersResponseSchema,
  "One page of a parent lane's containers.",
  {
    nextWatermark:
      "Position after this page's last row, or the request's watermark when the page is empty; keep it for the next incremental poll. `hasMore` says whether rows remain now.",
    tombstones:
      "Containers removed from the caller's view in this page's range.",
  },
);

describeSchema(
  ListContainerParentLanesRequestSchema,
  "Up to four parent lanes to list, each with its own watermark and page size.",
);

describeSchema(
  ListContainerParentLanesResponseSchema,
  "One page per requested parent lane, in request order.",
);

describeSchema(
  ListContainerDocumentLanesRequestSchema,
  "Up to 32 container lanes to list documents for, each with its own watermark and page size (500 rows in total).",
);

describeSchema(
  ContainerDocumentSummaryResponseSchema,
  "One document in a container listing, with the caller's effective access to it.",
  {
    currentAccessEpoch: "Epoch of the document's current link-set manifest.",
    currentAccessStateHash: "Hash of the document's current link-set manifest.",
    effectiveAccessLevel:
      "The caller's access, derived from signed grants along the linked container paths.",
    linkedContainerIds: "Containers the document is linked into.",
    referencedPrincipals:
      "Principal policy heads the document's access depends on.",
  },
);

describeSchema(
  ContainerDocumentSyncTombstoneResponseSchema,
  "A document that left a container's listing since the last page.",
);

describeSchema(
  ListContainerDocumentsResponseSchema,
  "One page of a container lane's documents.",
  {
    nextWatermark:
      "Position after this page's last row, or the request's watermark when the page is empty; keep it for the next incremental poll. `hasMore` says whether rows remain now.",
    tombstones: "Documents removed from the container in this page's range.",
  },
);

describeSchema(
  ContainerNotFoundErrorResponseSchema,
  "The container does not exist. Clients may treat only this exact coded 404 as permanent absence.",
);

describeSchema(
  ContainerMutationErrorCodeSchema,
  "A machine-readable reason a container mutation was refused, which tells the client whether to replan, adopt, or stop.",
);

describeSchema(
  ContainerMutationFailureResponseSchema,
  "A refused container mutation: a coded conflict, or a stale principal policy with the current heads.",
);

describeSchema(
  ContainerKekKeyringWireRecordSchema,
  "A container KEK keyring: every predecessor KEK of a container, sealed under the KEK of one epoch.",
  {
    containerKeyEpochId: "Container KEK epoch whose key seals the keyring.",
    iv: "Base64 AES-GCM initialization vector.",
    sealed:
      "Base64 ciphertext; its length is an exact function of the epoch number.",
    sealingSuite: "Cipher suite used to seal the keyring.",
  },
);

describeSchema(
  ContainerKekLogEpochResponseSchema,
  "One epoch of a container's KEK rotation log.",
  {
    accessManifestHash: "Container manifest head that introduced the epoch.",
    bridge:
      "The predecessor bridge: the previous epoch's KEK encrypted under this one, or null for the first epoch.",
    keyring:
      "Keyring sealed under this epoch's KEK, or null for the first epoch.",
    parentContainerKeyEpochId:
      "The parent container's KEK epoch at this epoch, or null for a container with no parent.",
    wraps:
      "Recipient wraps issued at this epoch, retained so a member present then can recover the KEK if a bridge is damaged.",
  },
);

describeSchema(
  ContainerKekLogResponseSchema,
  "One page of a container's KEK rotation log, oldest epoch first.",
  { hasMore: "True when later epochs remain." },
);

describeSchema(
  CitedContainerKekLevelSchema,
  "A KEK level the client said it already holds, replaced by a digest of its bytes; the client fills it back in from its own copy.",
  {
    levelDigest:
      "Domain-separated SHA-256 of the level's canonical wire bytes.",
    containerManifestHistory:
      "Manifest citations of the level, kept so the response's bundle bookkeeping stays exact.",
  },
);

describeSchema(
  ContainerWriterProjectionWireResponseSchema,
  "A container writer projection: the signed manifests on its path and the KEK levels a client needs to read and write under it. Every manifest is carried once in `bundles` and cited by hash.",
  {
    bundles: "Signed manifest bundles keyed by manifest hash.",
    omittedBundles:
      "Cited hashes left out because the request said the client holds them.",
    containerKeks: "One KEK level for each manifest in `path`.",
    path: "Manifest hashes from the organization's root to this container.",
    policyEvidence:
      "Public principal policy history the cited manifests depend on.",
  },
);

describeSchema(
  ContainerWriterProjectionErrorResponseSchema,
  "The API's stored state for the projection failed its own consistency checks.",
);

describeSchema(
  ListDocumentEditAttributionRangesResponseSchema,
  "One page of a document's complete edit attribution.",
);
