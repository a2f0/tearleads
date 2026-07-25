import type { useExplorerModel } from "./hooks/useExplorerModel";

type ExplorerModel = ReturnType<typeof useExplorerModel>;

function shouldShowContainerAction(
  showToolbar: boolean,
  activeContainerHasRules: boolean,
  canPerform: boolean,
): boolean {
  return showToolbar && (!activeContainerHasRules || canPerform);
}

export function getExplorerContainerToolbarVisibility(
  model: ExplorerModel,
  showContactsToolbar: boolean,
  showStandardToolbar: boolean,
) {
  return {
    createChild: shouldShowContainerAction(
      showStandardToolbar,
      model.activeContainerHasRules,
      model.canCreateChildInActiveContainer,
    ),
    createContact: shouldShowContainerAction(
      showContactsToolbar,
      model.activeContainerHasRules,
      model.canCreateContactInActiveContainer,
    ),
    createDocument: shouldShowContainerAction(
      showStandardToolbar,
      model.activeContainerHasRules,
      model.canCreateStructuredDocumentInActiveContainer,
    ),
    upload: shouldShowContainerAction(
      showStandardToolbar,
      model.activeContainerHasRules,
      model.canUploadToActiveContainer,
    ),
  };
}
