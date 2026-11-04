import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { LinkBreakIcon } from "@phosphor-icons/react/dist/csr/LinkBreak";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { useState } from "react";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { isIgnorableDatabaseWorkerError } from "../../../../stores/explorer/documentRuntime";
import {
  EXPLORER_LABELS,
  getExplorerActivateLinkedContainerError,
  getExplorerDetachLinkedContainerError,
} from "../../labels";
import { canWriteContainerNode } from "../../model/containerRules";
import { compactId } from "../compactId";
import { ExplorerDetachLinkedContainerDialog } from "./ExplorerDetachLinkedContainerDialog";
import {
  type ExplorerInfoContainerAction,
  ExplorerInfoContainerList,
  ExplorerInfoContainerRow,
  getGoToContainerAction,
} from "./ExplorerInfoContainerRow";

interface LinkedContainerDetail {
  available: boolean;
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
      available: linkedContainer !== undefined,
      id: linkedContainerId,
      canWrite: canWriteContainerNode(linkedContainer),
      icon: linkedContainer?.icon ?? null,
      isActive: linkedContainerId === activeContainerId,
      label: linkedContainer?.name ?? compactId(linkedContainerId),
    };
  });
}

async function handleActivateLinkedContainer(params: {
  activateLinkedContainer: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  linkedContainer: LinkedContainerDetail;
  logError: (message: string | Error, cause?: unknown) => void;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
}) {
  const {
    activateLinkedContainer,
    linkedContainer,
    logError,
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
    if (!isIgnorableDatabaseWorkerError(error)) {
      logError("Failed to activate the linked explorer container", error);
    }
    setActionError(
      getExplorerActivateLinkedContainerError(linkedContainer.label),
    );
  } finally {
    setActivatingContainerId(null);
  }
}

async function handleDetachLinkedContainer(params: {
  linkedContainer: LinkedContainerDetail;
  logError: (message: string | Error, cause?: unknown) => void;
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
    logError,
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
    if (!isIgnorableDatabaseWorkerError(error)) {
      logError("Failed to detach the linked explorer container", error);
    }
    setActionError(
      getExplorerDetachLinkedContainerError(linkedContainer.label),
    );
  } finally {
    setUnlinkingContainerId(null);
  }
}

type DocumentLinkMutation = (
  documentId: string,
  containerId: string,
) => Promise<DocumentSummary | null>;

interface LinkedContainerRowParams {
  activateLinkedContainer: DocumentLinkMutation;
  actionBusy: boolean;
  activatingContainerId: string | null;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainer: LinkedContainerDetail;
  logError: (message: string | Error, cause?: unknown) => void;
  requestDetach: (linkedContainer: LinkedContainerDetail) => void;
  selectedDocumentId: string;
  setActionError: (error: string | null) => void;
  setActivatingContainerId: (containerId: string | null) => void;
  setSelectedId: (id: string | null) => void;
  showActivationControls: boolean;
}

function getMakeActiveAction(
  params: LinkedContainerRowParams,
): ExplorerInfoContainerAction | null {
  const { actionBusy, linkedContainer } = params;
  if (!params.showActivationControls || linkedContainer.isActive) {
    return null;
  }

  return {
    disabled: !params.canActivateSelectedDocument || actionBusy,
    icon: CheckCircleIcon,
    id: "make-active",
    label:
      params.activatingContainerId === linkedContainer.id
        ? EXPLORER_LABELS.linkedContainerActivatingAction
        : EXPLORER_LABELS.linkedContainerMakeActiveAction,
    onSelect: () => {
      if (actionBusy) {
        return;
      }

      void handleActivateLinkedContainer({
        activateLinkedContainer: params.activateLinkedContainer,
        linkedContainer,
        logError: params.logError,
        selectedDocumentId: params.selectedDocumentId,
        setActionError: params.setActionError,
        setActivatingContainerId: params.setActivatingContainerId,
      });
    },
  };
}

function getLinkedContainerActions(
  params: LinkedContainerRowParams,
): ReadonlyArray<ExplorerInfoContainerAction> {
  const { actionBusy, linkedContainer } = params;
  const makeActive = getMakeActiveAction(params);

  return [
    getGoToContainerAction({
      available: linkedContainer.available,
      containerId: linkedContainer.id,
      setSelectedId: params.setSelectedId,
    }),
    ...(makeActive ? [makeActive] : []),
    {
      disabled:
        !params.canUnlinkSelectedDocument ||
        !linkedContainer.canWrite ||
        actionBusy,
      icon: LinkBreakIcon,
      id: "detach",
      label: EXPLORER_LABELS.linkedContainerDetachMenuAction,
      onSelect: () => {
        if (!actionBusy) {
          params.requestDetach(linkedContainer);
        }
      },
    },
  ];
}

function LinkedContainerRow(params: LinkedContainerRowParams) {
  const { linkedContainer } = params;

  return (
    <ExplorerInfoContainerRow
      actions={getLinkedContainerActions(params)}
      containerId={linkedContainer.id}
      icon={linkedContainer.icon}
      label={linkedContainer.label}
      trailing={
        params.showActivationControls && linkedContainer.isActive ? (
          <span className="explorer-linked-container-badge">
            {EXPLORER_LABELS.linkedContainerActiveBadge}
          </span>
        ) : null
      }
    />
  );
}

export function ExplorerLinkedContainerSection(params: {
  activeContainerId: string | null;
  activateLinkedContainer: DocumentLinkMutation;
  canActivateSelectedDocument: boolean;
  canUnlinkSelectedDocument: boolean;
  linkedContainerIds: ReadonlyArray<string>;
  logError: (message: string | Error, cause?: unknown) => void;
  nodes: ReadonlyArray<ContainerNode>;
  selectedDocumentId: string;
  setSelectedId: (id: string | null) => void;
  showActivationControls: boolean;
  unlinkDocument: DocumentLinkMutation;
}) {
  const { logError, selectedDocumentId, unlinkDocument } = params;
  const [actionError, setActionError] = useState<string | null>(null);
  const [activatingContainerId, setActivatingContainerId] = useState<
    string | null
  >(null);
  const [unlinkingContainerId, setUnlinkingContainerId] = useState<
    string | null
  >(null);
  const [detachCandidate, setDetachCandidate] =
    useState<LinkedContainerDetail | null>(null);
  const linkedContainers = getLinkedContainerDetails(
    params.nodes,
    params.linkedContainerIds,
    params.activeContainerId,
  );
  const actionBusy =
    activatingContainerId !== null || unlinkingContainerId !== null;

  return (
    <MiniAppInfoSection
      className="explorer-linked-container-section"
      heading={EXPLORER_LABELS.linkedContainersHeading}
    >
      <MiniAppStatus>{EXPLORER_LABELS.linkedContainersHint}</MiniAppStatus>
      {linkedContainers.length === 0 ? (
        <MiniAppStatus>{EXPLORER_LABELS.linkedContainersEmpty}</MiniAppStatus>
      ) : (
        <ExplorerInfoContainerList
          aria-label={EXPLORER_LABELS.linkedContainersHeading}
        >
          {linkedContainers.map((linkedContainer) => (
            <LinkedContainerRow
              actionBusy={actionBusy}
              activateLinkedContainer={params.activateLinkedContainer}
              activatingContainerId={activatingContainerId}
              canActivateSelectedDocument={params.canActivateSelectedDocument}
              canUnlinkSelectedDocument={params.canUnlinkSelectedDocument}
              key={linkedContainer.id}
              linkedContainer={linkedContainer}
              logError={logError}
              requestDetach={setDetachCandidate}
              selectedDocumentId={selectedDocumentId}
              setActionError={setActionError}
              setActivatingContainerId={setActivatingContainerId}
              setSelectedId={params.setSelectedId}
              showActivationControls={params.showActivationControls}
            />
          ))}
        </ExplorerInfoContainerList>
      )}
      {actionError ? (
        <MiniAppStatus as="span" tone="error">
          {actionError}
        </MiniAppStatus>
      ) : null}
      {detachCandidate ? (
        <ExplorerDetachLinkedContainerDialog
          busy={unlinkingContainerId !== null}
          containerLabel={detachCandidate.label}
          onCancel={() => setDetachCandidate(null)}
          onConfirm={() => {
            void handleDetachLinkedContainer({
              linkedContainer: detachCandidate,
              logError,
              selectedDocumentId,
              setActionError,
              setUnlinkingContainerId,
              unlinkDocument,
            }).finally(() => setDetachCandidate(null));
          }}
        />
      ) : null}
    </MiniAppInfoSection>
  );
}
