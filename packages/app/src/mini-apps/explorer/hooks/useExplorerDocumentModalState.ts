import type { DocumentSummary } from "@symcrypt/client-sdk";
import { useExplorerModalController } from "../modal/controller";
import type { ExplorerModalController } from "../modal/types";
import type { ExplorerContainerRulesContext } from "../model/containerRules";
import type {
  ExplorerDocumentMutationAction,
  ExplorerModelExplorer,
} from "./explorerModelTypes";

export type ExplorerDocumentModalState = ExplorerModalController;

export function useExplorerDocumentModalState(params: {
  explorer: ExplorerModelExplorer;
  linkDocument: ExplorerDocumentMutationAction;
  moveDocument: ExplorerDocumentMutationAction;
  canShareWithPeer: boolean;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  online: boolean;
  peerUserId: string | null;
  rulesContext: ExplorerContainerRulesContext;
  setSelectedId: (id: string | null) => void;
  selectionExpandNode: (nodeId: string) => void;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  startContainerPurge: (containerId: string) => void;
  startEmptyTrash: (trashContainerId: string) => void;
}): ExplorerDocumentModalState {
  const {
    explorer,
    linkDocument,
    moveDocument,
    canShareWithPeer,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    online,
    peerUserId,
    rulesContext,
    setSelectedId,
    selectionExpandNode,
    shareWithUser,
    startContainerPurge,
    startEmptyTrash,
  } = params;

  return useExplorerModalController({
    createChild: explorer.createChild,
    expandNode: selectionExpandNode,
    linkDocument,
    moveContainer: explorer.moveContainer,
    moveDocument,
    nodes: explorer.nodes,
    documentSummaries,
    linkedContainerIdsByDocumentId,
    canShareWithPeer,
    online,
    peerUserId,
    startContainerPurge,
    startEmptyTrash,
    renameContainer: explorer.renameContainer,
    rulesContext,
    setSelectedId,
    shareWithUser,
  });
}
