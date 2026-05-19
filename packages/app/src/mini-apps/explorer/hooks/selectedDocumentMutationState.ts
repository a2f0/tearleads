import type { DocumentSummary } from "@tearleads/client-sdk/data/documentSummary";
import type { useAppData } from "../../../providers/data/AppDataProvider";
import type { MoveTargetOption } from "../targetOptions";

export function getSelectedDocumentMutationState(params: {
  appData: Pick<
    ReturnType<typeof useAppData>,
    "dbStatus" | "isAuthenticated" | "online"
  >;
  selectedDocument: DocumentSummary | undefined;
  selectedDocumentLinkTargetOptions: ReadonlyArray<MoveTargetOption>;
  selectedDocumentLinkedContainerIds: ReadonlyArray<string>;
  selectedDocumentMoveTargetOptions: ReadonlyArray<MoveTargetOption>;
}) {
  const {
    appData,
    selectedDocument,
    selectedDocumentLinkTargetOptions,
    selectedDocumentLinkedContainerIds,
    selectedDocumentMoveTargetOptions,
  } = params;
  const canActivateSelectedDocument =
    appData.dbStatus === "ready" && !!selectedDocument?.documentId;
  const canMutateSelectedDocument =
    canActivateSelectedDocument && appData.isAuthenticated && appData.online;

  return {
    canActivateSelectedDocument,
    canLinkSelectedDocument:
      canMutateSelectedDocument && selectedDocumentLinkTargetOptions.length > 0,
    canMoveSelectedDocument:
      canMutateSelectedDocument && selectedDocumentMoveTargetOptions.length > 0,
    canUnlinkSelectedDocument:
      canMutateSelectedDocument &&
      selectedDocumentLinkedContainerIds.length > 1,
  };
}
