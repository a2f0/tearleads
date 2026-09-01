import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { ExplorerContainerRulesContext } from "../model/containerRules";
import type { MoveTargetOption } from "../model/targetOptions";

export type ExplorerModalState =
  | { mode: "create-child"; nodeId: string }
  | { mode: "empty-trash"; nodeId: string }
  | { mode: "link-document"; documentLocalId: string }
  | { mode: "move"; nodeId: string }
  | { mode: "move-document"; documentLocalId: string }
  | { mode: "purge"; nodeId: string }
  | { mode: "rename"; nodeId: string }
  | { mode: "share-peer"; nodeId: string };

// Mutation actions and connectivity state shared by the modal controller and
// the submit dispatcher (actions.ts), so the two param types cannot drift.
export interface ExplorerModalMutationParams {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  expandNode: (nodeId: string) => void;
  linkDocument: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  moveDocument: (
    documentId: string,
    targetContainerId: string,
  ) => Promise<DocumentSummary | null>;
  canShareWithPeer: boolean;
  nodes: ReadonlyArray<ContainerNode>;
  // Whether the client currently has connectivity. Permanent deletion (purge) is
  // online-only — it has no offline outbox — so the purge submit uses this to
  // surface a clear "must be online" message instead of a generic failure.
  online: boolean;
  peerUserId: string | null;
  // Kick off the long-running "Delete Forever" purge run (which owns the progress
  // + cancel modal). Fire-and-forget from the confirm modal's perspective — the
  // run reports its own progress; the confirm modal just closes.
  startContainerPurge: (containerId: string) => void;
  startEmptyTrash: (trashContainerId: string) => void;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setSelectedId: (id: string | null) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
}

export interface ExplorerModalControllerParams
  extends ExplorerModalMutationParams {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  rulesContext: ExplorerContainerRulesContext;
  // Linked containers per document id, so link targets are computed for whatever
  // document a modal operates on (selection or right-clicked row) rather than a
  // single pre-selected document.
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}

export interface ExplorerModalController {
  backgroundActionError: string | null;
  closeModal: () => void;
  draftName: string;
  draftTargetContainerId: string;
  handleModalSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSubmittingModal: boolean;
  modalError: string | null;
  modalState: ExplorerModalState | null;
  moveTargetOptions: ReadonlyArray<MoveTargetOption>;
  nameInputRef: RefObject<HTMLInputElement | null>;
  openCreateChildModal: (nodeId: string) => void;
  openEmptyTrashModal: (nodeId: string) => void;
  openLinkDocumentModal: (documentLocalId: string) => void;
  openMoveDocumentModal: (documentLocalId: string) => void;
  openMoveModal: (nodeId: string) => void;
  openPurgeModal: (nodeId: string) => void;
  openRenameModal: (nodeId: string) => void;
  openSharePeerModal: (nodeId: string) => void;
  setDraftName: Dispatch<SetStateAction<string>>;
  setDraftTargetContainerId: Dispatch<SetStateAction<string>>;
  setModalError: Dispatch<SetStateAction<string | null>>;
  targetSelectRef: RefObject<HTMLButtonElement | null>;
}
