import { EXPLORER_LABELS } from "../labels";
import type { ExplorerModalState } from "./types";

export function getExplorerModalError(
  mode: ExplorerModalState["mode"],
): string {
  switch (mode) {
    case "create-child":
      return "Failed to create child container.";
    case "empty-trash":
      return "Failed to empty the Trash.";
    case "rename":
      return "Failed to rename container.";
    case "link-document":
      return "Failed to link document.";
    case "move":
      return "Failed to move container.";
    case "move-document":
      return "Failed to move document.";
    case "purge":
      return "Failed to delete container forever.";
    case "share-peer":
      return "Failed to share container with peer.";
  }
}

export function getExplorerModalLog(mode: ExplorerModalState["mode"]): string {
  switch (mode) {
    case "create-child":
      return "Failed to create child container:";
    case "empty-trash":
      return "Failed to empty the Trash:";
    case "rename":
      return "Failed to rename container:";
    case "link-document":
      return "Failed to link document:";
    case "move":
      return "Failed to move container:";
    case "move-document":
      return "Failed to move document:";
    case "purge":
      return "Failed to delete container forever:";
    case "share-peer":
      return "Failed to share container with peer:";
  }
}

export function getExplorerModalTitle(modalState: ExplorerModalState): string {
  switch (modalState.mode) {
    case "empty-trash":
      return "Empty Trash";
    case "link-document":
      return "Link Document";
    case "move":
      return "Move Container";
    case "move-document":
      return "Move Document";
    case "purge":
      return "Delete Container Forever";
    case "share-peer":
      return "Share Container";
    case "rename":
      return "Rename Container";
    case "create-child":
      return EXPLORER_LABELS.createChildFolderAction;
  }
}

export function getExplorerModalSubmitLabel(
  modalState: ExplorerModalState,
  isSubmittingModal: boolean,
): string {
  if (!isSubmittingModal) {
    switch (modalState.mode) {
      case "empty-trash":
        return EXPLORER_LABELS.containerEmptyTrashAction;
      case "link-document":
        return "Link";
      case "move":
        return "Move";
      case "move-document":
        return "Move";
      case "purge":
        return "Delete Forever";
      case "share-peer":
        return "Share";
      case "rename":
        return "Rename";
      case "create-child":
        return "Create";
    }
  }

  switch (modalState.mode) {
    case "empty-trash":
      return "Emptying...";
    case "link-document":
      return "Linking...";
    case "move":
      return "Moving...";
    case "move-document":
      return "Moving...";
    case "purge":
      return "Deleting...";
    case "share-peer":
      return "Sharing...";
    case "rename":
      return "Renaming...";
    case "create-child":
      return "Creating...";
  }
}

export function isExplorerModalSubmitDisabled(params: {
  draftName: string;
  draftTargetContainerId: string;
  isSubmittingModal: boolean;
  modalState: ExplorerModalState;
  peerUserId: string | null;
}): boolean {
  const {
    draftName,
    draftTargetContainerId,
    isSubmittingModal,
    modalState,
    peerUserId,
  } = params;
  if (isSubmittingModal) {
    return true;
  }

  const nameIsRequired =
    modalState.mode === "create-child" || modalState.mode === "rename";
  if (nameIsRequired && draftName.trim().length === 0) {
    return true;
  }

  if (
    (modalState.mode === "link-document" ||
      modalState.mode === "move" ||
      modalState.mode === "move-document") &&
    draftTargetContainerId.length === 0
  ) {
    return true;
  }

  if (modalState.mode === "share-peer" && !peerUserId) {
    return true;
  }

  return false;
}
