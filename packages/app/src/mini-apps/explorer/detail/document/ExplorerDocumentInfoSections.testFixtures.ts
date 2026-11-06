import type { DocumentInfo } from "@tearleads/client-sdk";

type DocumentInfoAttributionSegment = NonNullable<
  DocumentInfo["remoteInfo"]
>["attributionSegments"][number];

type DocumentInfoCharacterBlame = NonNullable<
  DocumentInfo["remoteInfo"]
>["characterBlame"];

type DocumentInfoBlameRanges = NonNullable<
  DocumentInfo["remoteInfo"]
>["blameRanges"];

type DocumentInfoFieldBlame = NonNullable<
  DocumentInfo["remoteInfo"]
>["fieldBlame"];

export function createRemoteInfo(
  activeAttachmentBindings: NonNullable<
    DocumentInfo["remoteInfo"]
  >["activeAttachmentBindings"],
  attributionSegments: ReadonlyArray<DocumentInfoAttributionSegment> = [],
  characterBlame: DocumentInfoCharacterBlame = {
    writers: [],
    totalCharacterCount: 0,
    unattributedCharacterCount: 0,
  },
  blameRanges: DocumentInfoBlameRanges = [],
  fieldBlame: DocumentInfoFieldBlame = [],
): NonNullable<DocumentInfo["remoteInfo"]> {
  return {
    activeAttachmentBindings,
    attributionRevision: 7,
    attributionSegments: [...attributionSegments],
    attributionStatus: "available",
    authorizingContainerPaths: [],
    blameRanges,
    characterBlame,
    fieldBlame,
    contentKeyEpoch: 1,
    contentKeyTargetCount: 1,
    contentKeyTargetHash: "content-key-target-hash",
    contributors: [],
    currentManifestHash: "document-manifest-hash",
    documentContainerManifestHistoryCount: 0,
    documentKekTargetCount: 1,
    documentKeyTargetHash: "document-key-target-hash",
    documentManifestContainerPathCount: 0,
    documentManifestHistoryCount: 0,
    linkedContainerKeyEpochCount: 0,
    linkedContainerManifestCount: 0,
    linkSetManifestHash: "link-set-manifest-hash",
    manifestEpoch: 1,
    previousManifestHash: null,
    referencedPrincipalCount: 1,
  };
}

export function createDocumentInfo(input: {
  attachments: DocumentInfo["attachments"];
  remoteInfo: DocumentInfo["remoteInfo"];
}): DocumentInfo {
  return {
    attachments: input.attachments,
    local: {
      accessEpoch: 1,
      accessStateHash: "access-state-hash",
      containerId: "container-1",
      documentId: "document-1",
      documentKind: "note",
      hasContentKeyBundle: true,
      hasDocumentKekTargets: true,
      hasDocumentManifestBundle: true,
      lastCommitLsn: "commit-1",
      localDocumentManifestHash: "local-document-manifest-hash",
      localId: "local-document-1",
      pendingAttachmentByteLength: 0,
      pendingAttachmentCount: 0,
      pendingUpdateCount: 0,
      title: "Note",
      updatedAt: "2026-06-20T10:00:00.000Z",
    },
    remoteInfo: input.remoteInfo,
  };
}
