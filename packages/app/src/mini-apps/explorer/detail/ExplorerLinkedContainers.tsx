import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { useState } from "react";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { MiniAppRow } from "../../../components/shared/MiniAppRow";
import { canWriteContainerNode } from "../containerRules";
import {
  EXPLORER_LABELS,
  getExplorerDetachLinkedContainerError,
  getExplorerDetachLinkedContainerLabel,
  getExplorerOpenLinkedContainerLabel,
} from "../labels";

interface LinkedContainerDetail {
  canWrite: boolean;
  id: string;
  label: string;
}

export function getLinkedContainerDetails(
  nodes: ReadonlyArray<ContainerNode>,
  linkedContainerIds: ReadonlyArray<string>,
): ReadonlyArray<LinkedContainerDetail> {
  const nodesById = new Map<string, ContainerNode>();
  for (const node of nodes) {
    if (!nodesById.has(node.id)) {
      nodesById.set(node.id, node);
    }
  }

  return linkedContainerIds.map((linkedContainerId) => {
    const linkedContainer = nodesById.get(linkedContainerId);

    return {
      id: linkedContainerId,
      canWrite: canWriteContainerNode(linkedContainer),
      label: linkedContainer?.name ?? linkedContainerId,
    };
  });
}

async function handleDetachLinkedContainer(params: {
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setUnlinkingContainerId,
    unlinkDocument,
  } = params;

  setActionError(null);
  setUnlinkingContainerId(linkedContainer.id);
  try {
    const unlinkedDocument = await unlinkDocument(
      selectedDocumentId,
      linkedContainer.id,
    );
    if (!unlinkedDocument) {
      setActionError(
        getExplorerDetachLinkedContainerError(linkedContainer.label),
      );
    }
  } catch (error: unknown) {
    console.error("Explorer: failed to detach linked container:", error);
    setActionError(
      getExplorerDetachLinkedContainerError(linkedContainer.label),
    );
  } finally {
    setUnlinkingContainerId(null);
  }
}

interface ExplorerLinkedContainerRowParams {
  canUnlinkSelectedDocument: boolean;
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  unlinkingContainerId: string | null;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}

function ExplorerLinkedContainerRow(params: ExplorerLinkedContainerRowParams) {
  const {
    canUnlinkSelectedDocument,
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setSelectedId,
    setUnlinkingContainerId,
    unlinkingContainerId,
    unlinkDocument,
  } = params;
  const actionBusy = unlinkingContainerId !== null;
  const canUnlinkLinkedContainer =
    canUnlinkSelectedDocument && linkedContainer.canWrite;

  return (
    <MiniAppRow
      as="li"
      className="explorer-linked-container-row"
      variant="framed"
    >
      <MiniAppButton
        className="explorer-linked-container-button"
        variant="ghost"
        aria-label={getExplorerOpenLinkedContainerLabel(linkedContainer.label)}
        onClick={() => {
          setSelectedId(linkedContainer.id);
        }}
      >
        {linkedContainer.label}
      </MiniAppButton>
      <div className="explorer-linked-container-actions">
        <MiniAppButton
          aria-label={getExplorerDetachLinkedContainerLabel(
            linkedContainer.label,
          )}
          disabled={!canUnlinkLinkedContainer || actionBusy}
          onClick={() => {
            if (actionBusy) {
              return;
            }

            void handleDetachLinkedContainer({
              linkedContainer,
              selectedDocumentId,
              setActionError,
              setUnlinkingContainerId,
              unlinkDocument,
            });
          }}
        >
          {unlinkingContainerId === linkedContainer.id
            ? EXPLORER_LABELS.linkedContainerDetachingAction
            : EXPLORER_LABELS.linkedContainerDetachAction}
        </MiniAppButton>
      </div>
    </MiniAppRow>
  );
}

export function ExplorerLinkedContainerSection(params: {
  canUnlinkSelectedDocument: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentId: string;
  setSelectedId: (id: string | null) => void;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    canUnlinkSelectedDocument,
    linkedContainerIds,
    nodes,
    selectedDocumentId,
    setSelectedId,
    unlinkDocument,
  } = params;
  const [actionError, setActionError] = useState<string | null>(null);
  const [unlinkingContainerId, setUnlinkingContainerId] = useState<
    string | null
  >(null);
  const linkedContainers = getLinkedContainerDetails(nodes, linkedContainerIds);

  return (
    <MiniAppInfoSection
      className="explorer-linked-container-section"
      heading={EXPLORER_LABELS.linkedContainersHeading}
    >
      {linkedContainers.length === 0 ? (
        <MiniAppStatus>{EXPLORER_LABELS.linkedContainersEmpty}</MiniAppStatus>
      ) : (
        <ul className="explorer-linked-container-list">
          {linkedContainers.map((linkedContainer) => (
            <ExplorerLinkedContainerRow
              canUnlinkSelectedDocument={canUnlinkSelectedDocument}
              key={linkedContainer.id}
              linkedContainer={linkedContainer}
              selectedDocumentId={selectedDocumentId}
              setActionError={setActionError}
              setSelectedId={setSelectedId}
              setUnlinkingContainerId={setUnlinkingContainerId}
              unlinkingContainerId={unlinkingContainerId}
              unlinkDocument={unlinkDocument}
            />
          ))}
        </ul>
      )}
      {actionError ? (
        <MiniAppStatus as="span" tone="error">
          {actionError}
        </MiniAppStatus>
      ) : null}
    </MiniAppInfoSection>
  );
}
