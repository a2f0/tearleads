import type { DocumentSummary } from "@tearleads/client-sdk/documents";
import type { ContainerNode } from "../../../stores/explorer/types";

export interface ExplorerModelExplorer {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: "admin" | "read" | "write",
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

export type ExplorerDocumentMutationAction = (
  noteId: string,
  targetContainerId: string,
) => Promise<DocumentSummary | null>;
