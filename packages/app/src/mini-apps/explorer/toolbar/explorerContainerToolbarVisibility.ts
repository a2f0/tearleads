interface ExplorerContainerToolbarVisibilityInput {
  activeContainerHasRules: boolean;
  canCreateChild: boolean;
  canCreateContact: boolean;
  canCreateDocument: boolean;
  canUpload: boolean;
  showContactsToolbar: boolean;
  showStandardToolbar: boolean;
}

interface ExplorerContainerToolbarVisibility {
  createChild: boolean;
  createContact: boolean;
  createDocument: boolean;
  upload: boolean;
}

function shouldShowContainerAction(
  showToolbar: boolean,
  activeContainerHasRules: boolean,
  canPerform: boolean,
): boolean {
  return showToolbar && (!activeContainerHasRules || canPerform);
}

export function getExplorerContainerToolbarVisibility(
  input: ExplorerContainerToolbarVisibilityInput,
): ExplorerContainerToolbarVisibility {
  const {
    activeContainerHasRules,
    canCreateChild,
    canCreateContact,
    canCreateDocument,
    canUpload,
    showContactsToolbar,
    showStandardToolbar,
  } = input;

  // System containers omit unavailable actions. Ordinary containers retain
  // disabled actions while permissions load to avoid toolbar pop-in.
  return {
    createChild: shouldShowContainerAction(
      showStandardToolbar,
      activeContainerHasRules,
      canCreateChild,
    ),
    createContact: shouldShowContainerAction(
      showContactsToolbar,
      activeContainerHasRules,
      canCreateContact,
    ),
    createDocument: shouldShowContainerAction(
      showStandardToolbar,
      activeContainerHasRules,
      canCreateDocument,
    ),
    upload: shouldShowContainerAction(
      showStandardToolbar,
      activeContainerHasRules,
      canUpload,
    ),
  };
}
