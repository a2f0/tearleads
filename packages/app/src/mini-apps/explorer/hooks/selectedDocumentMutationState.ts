import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isExplorerContainerUnderTrash } from "../../../stores/explorer/ExplorerSystemContainers";
import {
  canDeleteDocumentByRules,
  canPurgeDocumentByRules,
  canWriteContainerNode,
  canWriteDocumentSummary,
  type ExplorerContainerRulesContext,
} from "../containerRules";
import type { MoveTargetOption } from "../targetOptions";

export function getSelectedDocumentMutationState(params: {
  appData: {
    auth: Pick<RuntimeSnapshot["auth"], "isAuthenticated">;
    infra: Pick<RuntimeSnapshot["infra"], "dbStatus">;
    state: Pick<RuntimeSnapshot["state"], "online">;
  };
  canResolveTrashContainer: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  rulesContext: ExplorerContainerRulesContext;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectedDocumentMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
  trashContainerId: string | null;
}) {
  const {
    appData,
    canResolveTrashContainer,
    nodes,
    rulesContext,
    selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
    trashContainerId,
  } = params;
  const canActivateSelectedDocument =
    appData.infra.dbStatus === "ready" && !!selectedDocument?.documentId;
  const selectedDocumentContainer =
    selectedDocument?.containerId === null || selectedDocument === undefined
      ? undefined
      : nodes.find((node) => node.id === selectedDocument.containerId);
  const selectedDocumentWritable = canWriteDocumentSummary(selectedDocument);
  const selectedDocumentContainerWritable =
    selectedDocument?.containerId === null ||
    canWriteContainerNode(selectedDocumentContainer);
  const canMutateSelectedDocument =
    canActivateSelectedDocument &&
    selectedDocumentWritable &&
    appData.auth.isAuthenticated &&
    appData.state.online;
  const canMutateUnsyncedSelectedDocument =
    appData.infra.dbStatus === "ready" &&
    selectedDocument?.documentId === null &&
    selectedDocumentWritable;
  const canMoveOrDeleteSelectedDocument =
    appData.infra.dbStatus === "ready" &&
    selectedDocument !== undefined &&
    selectedDocument.containerId !== null &&
    selectedDocumentWritable &&
    selectedDocumentContainerWritable;

  return {
    canActivateSelectedDocument,
    canDeleteSelectedDocument:
      canMoveOrDeleteSelectedDocument &&
      canResolveTrashContainer &&
      selectedDocument.containerId !== trashContainerId &&
      canDeleteDocumentByRules(rulesContext, selectedDocument),
    canLinkSelectedDocument:
      canMutateSelectedDocument && selectedDocumentLinkTargetOptions.length > 0,
    canMoveSelectedDocument:
      canMoveOrDeleteSelectedDocument &&
      selectedDocumentMoveTargetOptions.length > 0,
    canPurgeSelectedDocument:
      (canMutateSelectedDocument || canMutateUnsyncedSelectedDocument) &&
      canResolveTrashContainer &&
      selectedDocument !== undefined &&
      selectedDocument.containerId !== null &&
      selectedDocumentWritable &&
      selectedDocumentContainerWritable &&
      canPurgeDocumentByRules(rulesContext, selectedDocument) &&
      // Purge applies anywhere under trash, not only at the trash root: a
      // document parked in a user-created subfolder of trash is still trashed.
      isExplorerContainerUnderTrash(
        nodes,
        selectedDocument.containerId,
        trashContainerId,
      ),
    canUnlinkSelectedDocument:
      canMutateSelectedDocument &&
      selectedDocumentLinkedContainerIds.length > 1,
  };
}
