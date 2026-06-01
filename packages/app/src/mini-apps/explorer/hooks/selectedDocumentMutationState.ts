import type { DocumentSummary } from "@tearleads/client-sdk";
import type { RuntimeSnapshot } from "../../../providers/sdk/TearleadsProvider";
import type { MoveTargetOption } from "../targetOptions";

export function getSelectedDocumentMutationState(params: {
  appData: {
    auth: Pick<RuntimeSnapshot["auth"], "isAuthenticated">;
    infra: Pick<RuntimeSnapshot["infra"], "dbStatus">;
    state: Pick<RuntimeSnapshot["state"], "online">;
  };
  canResolveTrashContainer: boolean;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectedDocumentMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
  trashContainerId: string | null;
}) {
  const {
    appData,
    canResolveTrashContainer,
    selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
    trashContainerId,
  } = params;
  const canActivateSelectedDocument =
    appData.infra.dbStatus === "ready" && !!selectedDocument?.documentId;
  const canMutateSelectedDocument =
    canActivateSelectedDocument &&
    appData.auth.isAuthenticated &&
    appData.state.online;
  const canMutateLocalSelectedDocument =
    appData.infra.dbStatus === "ready" && selectedDocument?.documentId === null;

  return {
    canActivateSelectedDocument,
    canDeleteSelectedDocument:
      (canMutateSelectedDocument || canMutateLocalSelectedDocument) &&
      canResolveTrashContainer &&
      selectedDocument !== undefined &&
      selectedDocument.containerId !== null &&
      selectedDocument.containerId !== trashContainerId,
    canLinkSelectedDocument:
      canMutateSelectedDocument && selectedDocumentLinkTargetOptions.length > 0,
    canMoveSelectedDocument:
      canMutateSelectedDocument && selectedDocumentMoveTargetOptions.length > 0,
    canUnlinkSelectedDocument:
      canMutateSelectedDocument &&
      selectedDocumentLinkedContainerIds.length > 1,
  };
}
