import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import { isContainerUnderTrash } from "../../../stores/explorer/ExplorerSystemContainers";
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
  trashSystemSlot: ContainerSystemSlot | null;
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
    trashSystemSlot,
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
  const canMoveSelectedDocument =
    appData.infra.dbStatus === "ready" &&
    selectedDocument !== undefined &&
    selectedDocumentWritable &&
    selectedDocumentContainerWritable;
  const canDeleteContainerScopedDocument =
    canMoveSelectedDocument &&
    selectedDocument !== undefined &&
    selectedDocument.containerId !== null;

  return {
    canDeleteSelectedDocument:
      canDeleteContainerScopedDocument &&
      canResolveTrashContainer &&
      selectedDocument.containerId !== trashContainerId &&
      canDeleteDocumentByRules(rulesContext, selectedDocument),
    canLinkSelectedDocument:
      canMutateSelectedDocument && selectedDocumentLinkTargetOptions.length > 0,
    canMoveSelectedDocument:
      canMoveSelectedDocument && selectedDocumentMoveTargetOptions.length > 0,
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
      // Rules-based (org-aware) so it matches the read-only-when-trashed gate —
      // a document in a peer's shared Trash is purgeable (if writable) too, not
      // only one in the viewer's own Trash.
      isContainerUnderTrash(nodes, selectedDocument.containerId, {
        currentOrganizationId: rulesContext.currentOrganizationId,
        trashSystemSlot,
      }),
    canUnlinkSelectedDocument:
      canMutateSelectedDocument &&
      selectedDocumentLinkedContainerIds.length > 1,
  };
}
