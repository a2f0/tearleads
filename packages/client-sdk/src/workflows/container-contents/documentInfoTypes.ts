import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import type {
  DocumentBlameRange,
  DocumentCharacterBlameSummary,
  DocumentContributor,
  DocumentFieldBlame,
} from "../../data/documents/editAttribution";

export type DocumentInfoRemoteMode = "if-synced" | "never";

export interface DocumentInfoLocalDetails {
  accessEpoch: number | null;
  accessStateHash: string | null;
  containerId: string | null;
  documentId: string | null;
  documentKind: StoredDocumentKind | null;
  hasContentKeyBundle: boolean;
  hasDocumentKekTargets: boolean;
  hasDocumentManifestBundle: boolean;
  lastCommitLsn: string | null;
  localDocumentManifestHash: string | null;
  localId: string;
  pendingAttachmentByteLength: number;
  pendingAttachmentCount: number;
  pendingUpdateCount: number;
  title: string | null;
  updatedAt: string | null;
}

export interface DocumentInfoAttachment {
  attachmentKind: "local" | "pending";
  blobId: string | null;
  byteLength: number;
  createdAt: string | null;
  localId: string;
  mimeType: string | null;
  name: string | null;
  slotId: string;
  storageKey: string;
  updatedAt: string | null;
}

export interface DocumentInfoRemoteAttachmentBinding {
  bindingId: string;
  blobId: string;
  slotId: string;
}

export interface DocumentInfoAuthorizingContainerPath {
  containerId: string;
  containerKeyEpoch: number | null;
  containerKeyEpochId: string | null;
  leafManifestHash: string | null;
  organizationId: string;
  pathLength: number;
}

export interface DocumentInfoRemoteDetails {
  activeAttachmentBindings: DocumentInfoRemoteAttachmentBinding[];
  attributionRevision: number | null;
  attributionStatus: "available" | "truncated" | "unavailable";
  attributionSegments: DocumentEditAttributionResponse["segments"];
  authorizingContainerPaths: DocumentInfoAuthorizingContainerPath[];
  /**
   * Contiguous per-writer runs of the current prose — the read-only "blame"
   * view that tints each phrase by who wrote it. Shares its `null` conditions
   * (and its single snapshot reconstruction) with {@link characterBlame}.
   */
  blameRanges: DocumentBlameRange[] | null;
  /**
   * Per-writer live-character blame, or `null` when it could not be computed —
   * the document has no local snapshot, the snapshot is too large to extract
   * op ids from cheaply, or the snapshot was unreadable.
   */
  characterBlame: DocumentCharacterBlameSummary | null;
  /**
   * Per-field blame for a structured document (who last set each field), or
   * `null` when it could not be computed. A note yields `[]` (no fields).
   */
  fieldBlame: DocumentFieldBlame[] | null;
  contentKeyEpoch: number;
  contentKeyTargetCount: number;
  contentKeyTargetHash: string;
  contributors: DocumentContributor[];
  currentManifestHash: string;
  documentContainerManifestHistoryCount: number;
  documentKekTargetCount: number;
  documentKeyTargetHash: string;
  documentManifestContainerPathCount: number;
  documentManifestHistoryCount: number;
  linkedContainerKeyEpochCount: number;
  linkedContainerManifestCount: number;
  linkSetManifestHash: string;
  manifestEpoch: number | null;
  previousManifestHash: string | null;
  referencedPrincipalCount: number | null;
}

export interface DocumentInfo {
  attachments: DocumentInfoAttachment[];
  local: DocumentInfoLocalDetails;
  remoteInfo: DocumentInfoRemoteDetails | null;
}
