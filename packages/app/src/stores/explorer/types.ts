import type { ContainerNode } from "../../mini-apps/explorer/types";
import type { ExplorerRuntime, ExplorerSyncState } from "./explorerSyncAgent";

export interface ExplorerContextValue {
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
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

export interface ExplorerSnapshot {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

export interface ExplorerStore {
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
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  getSnapshot: () => ExplorerSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ExplorerRuntime) => void;
}

export interface ExplorerStoreState extends ExplorerSyncState {
  listeners: Set<() => void>;
  snapshot: ExplorerSnapshot;
  writeChain: Promise<ContainerNode | null>;
}

export type NullableExplorerDocumentField =
  | "accessStateHash"
  | "lastCommitLsn"
  | "contentKeyBundle"
  | "documentKekTargets"
  | "documentManifestBundle";
