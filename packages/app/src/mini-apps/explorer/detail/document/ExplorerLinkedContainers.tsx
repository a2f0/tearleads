import type { ContainerNode, DocumentSummary } from "@symcrypt/client-sdk";
import { useState } from "react";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppRow } from "../../../../components/mini-app/rows/MiniAppRow";
import {
  EXPLORER_LABELS,
  getExplorerActivateLinkedContainerError,
  getExplorerDetachLinkedContainerError,
  getExplorerDetachLinkedContainerLabel,
  getExplorerMakeLinkedContainerActiveLabel,
  getExplorerOpenLinkedContainerLabel,
} from "../../labels";
import { canWriteContainerNode } from "../../model/containerRules";
import { ExplorerContainerIcon } from "../../shared/ExplorerContainerIcon";

interface LinkedContainerDetail {
  canWrite: boolean;
  icon: string | null;
  id: string;
  isActive: boolean;
  label: string;
}

export function getLinkedContainerDetails(
  nodes: ReadonlyArray<ContainerNode>,
  linkedContainerIds: ReadonlyArray<string>,
  activeContainerId: string | null = null,
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
      icon: linkedContainer?.icon ?? null,
      isActive: linkedContainerId === activeContainerId,
      label: linkedContainer?.name ?? linkedContainerId,
    };
  });
}

async function handleActivateLinkedContainer(params: {
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
}) {
  const {
    activateLinkedContainer,
    linkedContainer,
    selectedDocumentId,
    setActionError,
    setActivatingContainerId,
  } = params;

  setActionError(null);
  setActivatingContainerId(linkedContainer.id);
  try {
    const activatedDocument = await activateLinkedContainer(
      selectedDocumentId,
      linkedContainer.id,
    );
    if (!activatedDocument) {
      setActionError(
        getExplorerActivateLinkedContainerError(linkedContainer.label),
      );
    }
  } catch (error: unknown) {
    console.error("Explorer: failed to activate linked container:", error);
    setActionError(
      getExplorerActivateLinkedContainerError(linkedContainer.label),
    );
  } finally {
    setActivatingContainerId(null);
  }
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
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  activatingContainerId: string | null;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainer: LinkedContainerDetail;
  selectedDocumentId: string;
  setActivatingContainerId: (containerId: string | null) => void;
  setActionError: (error: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setUnlinkingContainerId: (containerId: string | null) => void;
  showActivationControls: boolean;
  unlinkingContainerId: string | null;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}

function ExplorerLinkedContainerRow(params: ExplorerLinkedContainerRowParams) {
  const {
    activateLinkedContainer,
    activatingContainerId,
    canActivateSelectedDocument,
    canUnlinkSelectedDocument,
    linkedContainer,
    selectedDocumentId,
    setActivatingContainerId,
    setActionError,
    setSelectedId,
    setUnlinkingContainerId,
    showActivationControls,
    unlinkingContainerId,
    unlinkDocument,
  } = params;
  const actionBusy =
    activatingContainerId !== null || unlinkingContainerId !== null;
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
        <span className="explorer-item-name">
          <ExplorerContainerIcon
            className="explorer-folder-icon"
            icon={linkedContainer.icon}
          />
          {linkedContainer.label}
        </span>
      </MiniAppButton>
      <div className="explorer-linked-container-actions">
        {showActivationControls ? (
          linkedContainer.isActive ? (
            <span className="explorer-linked-container-badge">
              {EXPLORER_LABELS.linkedContainerActiveBadge}
            </span>
          ) : (
            <MiniAppButton
              aria-label={getExplorerMakeLinkedContainerActiveLabel(
                linkedContainer.label,
              )}
              disabled={!canActivateSelectedDocument || actionBusy}
              onClick={() => {
                if (actionBusy) {
                  return;
                }

                void handleActivateLinkedContainer({
                  activateLinkedContainer,
                  linkedContainer,
                  selectedDocumentId,
                  setActionError,
                  setActivatingContainerId,
                });
              }}
            >
              {activatingContainerId === linkedContainer.id
                ? EXPLORER_LABELS.linkedContainerActivatingAction
                : EXPLORER_LABELS.linkedContainerMakeActiveAction}
            </MiniAppButton>
          )
        ) : null}
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
  activeContainerId: string | null;
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentId: string;
  setSelectedId: (id: string | null) => void;
  showActivationControls: boolean;
  unlinkDocument: (
    documentId: string,
    removedContainerId: string,
  ) => Promise<DocumentSummary | null>;
}) {
  const {
    activeContainerId,
    activateLinkedContainer,
    canActivateSelectedDocument,
    canUnlinkSelectedDocument,
    linkedContainerIds,
    nodes,
    selectedDocumentId,
    setSelectedId,
    showActivationControls,
    unlinkDocument,
  } = params;
  const [actionError, setActionError] = useState<string | null>(null);
  const [activatingContainerId, setActivatingContainerId] = useState<
    string | null
  >(null);
  const [unlinkingContainerId, setUnlinkingContainerId] = useState<
    string | null
  >(null);
  const linkedContainers = getLinkedContainerDetails(
    nodes,
    linkedContainerIds,
    activeContainerId,
  );

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
              activateLinkedContainer={activateLinkedContainer}
              activatingContainerId={activatingContainerId}
              canActivateSelectedDocument={canActivateSelectedDocument}
              canUnlinkSelectedDocument={canUnlinkSelectedDocument}
              key={linkedContainer.id}
              linkedContainer={linkedContainer}
              selectedDocumentId={selectedDocumentId}
              setActivatingContainerId={setActivatingContainerId}
              setActionError={setActionError}
              setSelectedId={setSelectedId}
              setUnlinkingContainerId={setUnlinkingContainerId}
              showActivationControls={showActivationControls}
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
