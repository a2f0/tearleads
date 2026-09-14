import type {
  ContainerNode,
  DocumentAttributionRangesPage,
  DocumentInfo,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { type RenderResult, render } from "@testing-library/react";
import { createElement } from "react";
import type { ExplorerAttributionProfileHydrationRequester } from "../../hooks/explorerAttributionReadModel";
import { ExplorerDocumentInfoPanel } from "./ExplorerDocumentInfoPanel";

const nodes = [
  {
    id: "container-1",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "archive-container",
    kind: "container",
    name: "Archive",
    organizationId: "org-1",
    parentId: "container-1",
    syncState: syncedContainerDocumentObjectSyncState,
  },
] satisfies ReadonlyArray<ContainerNode>;

export const documentInfo = {
  attachments: [],
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
    title: "Document",
    updatedAt: "2026-06-20T10:00:00.000Z",
  },
  remoteInfo: {
    activeAttachmentBindings: [],
    attributionRevision: 7,
    attributionStatus: "available",
    blameRanges: [],
    fieldBlame: [],
    characterBlame: {
      writers: [],
      totalCharacterCount: 0,
      unattributedCharacterCount: 0,
    },
    attributionSegments: [
      {
        peerId: "peer-1",
        startCounter: 0,
        endCounter: 7,
        writerUserId: "writer-1",
        writerKeyFingerprint: "writer-fingerprint-1",
        authorityKind: "direct",
      },
    ],
    authorizingContainerPaths: [],
    contentKeyEpoch: 1,
    contentKeyTargetCount: 1,
    contentKeyTargetHash: "content-key-target-hash",
    contributors: [
      {
        writerUserId: "writer-1",
        writerKeyFingerprint: "writer-fingerprint-1",
        opCount: 7,
        directOpCount: 7,
        baselineOpCount: 0,
        hasDirectAuthority: true,
        hasBaselineAuthority: false,
      },
    ],
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
  },
} satisfies DocumentInfo;

export const documentSummary = {
  containerId: "container-1",
  documentId: "document-1",
  id: "local-document-1",
  title: "Document",
  updatedAt: "2026-06-20T10:00:00.000Z",
} satisfies DocumentSummary;

export interface DocumentInfoPanelTestInput {
  activateLinkedContainer?: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateLinkedContainer?: boolean | undefined;
  fallbackDocumentSummary: DocumentSummary | null;
  loadDocumentAttributionRanges?: () => Promise<DocumentAttributionRangesPage>;
  loadDocumentInfo?: (localId: string) => Promise<DocumentInfo>;
  loadDocumentSummary?: (localId: string) => Promise<DocumentSummary | null>;
  localId?: string | undefined;
  logError?: ((message: string | Error, cause?: unknown) => void) | undefined;
  requestAttributionProfileHydration?:
    | ExplorerAttributionProfileHydrationRequester
    | undefined;
  showDocumentEditRanges?: boolean | undefined;
  showLinkedDocumentActivationControls?: boolean | undefined;
  unlinkDocument?: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}

export function renderDocumentInfoPanel(
  input: DocumentInfoPanelTestInput,
): RenderResult {
  return render(createElement(ExplorerDocumentInfoPanel, panelProps(input)));
}

export function panelProps(input: DocumentInfoPanelTestInput) {
  return {
    activateLinkedContainer:
      input.activateLinkedContainer ?? (async () => null),
    canActivateLinkedContainer: input.canActivateLinkedContainer ?? true,
    canMutateDocumentLinks: true,
    containerId: "container-1",
    documentTitle: undefined,
    fallbackDocumentSummary: input.fallbackDocumentSummary,
    linkedContainerIdsByDocumentId: new Map([
      ["document-1", ["container-1", "archive-container"]],
    ]),
    loadDocumentAttributionRanges:
      input.loadDocumentAttributionRanges ??
      (async () => {
        throw new Error("Unexpected edit-ranges request.");
      }),
    loadDocumentInfo: input.loadDocumentInfo ?? (async () => documentInfo),
    loadDocumentSummary:
      input.loadDocumentSummary ?? (async () => documentSummary),
    localId: input.localId ?? "local-document-1",
    logError: input.logError ?? (() => undefined),
    nodes,
    openBlobBrowserRoute: () => undefined,
    requestAttributionProfileHydration:
      input.requestAttributionProfileHydration ?? (() => undefined),
    setSelectedId: () => undefined,
    showDocumentEditRanges: input.showDocumentEditRanges ?? false,
    showLinkedDocumentActivationControls:
      input.showLinkedDocumentActivationControls ?? false,
    unlinkDocument: input.unlinkDocument ?? (async () => null),
  };
}
