import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerDocumentObjectSyncState } from "../../workflows/container-contents/syncState";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
} from "./syncAgent";

export type ContainerContentsShareAccessLevel = "admin" | "read" | "write";

export interface ContainerContentsStoreOptions {
  logLabel?: string | undefined;
  persistence?: ContainerContentsPersistence | undefined;
}

export interface ContainerNode {
  systemSlot?: ContainerSystemSlot | null;
  createdAt?: string | null;
  id: string;
  icon?: string | null;
  metadataDocumentId?: string | null;
  organizationId: string;
  name: string;
  parentId: string | null;
  syncState: ContainerDocumentObjectSyncState;
  kind: "container";
  updatedAt?: string | null;
}

export interface ContainerContentsContextValue {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  ensureSystemContainer: (
    systemSlot: ContainerSystemSlot,
    name: string,
  ) => Promise<ContainerNode | null>;
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
    accessLevel: ContainerContentsShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

export interface ContainerContentsSnapshot {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

export interface ContainerContentsStore {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  ensureSystemContainer: (
    systemSlot: ContainerSystemSlot,
    name: string,
  ) => Promise<ContainerNode | null>;
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
    accessLevel: ContainerContentsShareAccessLevel,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  getSnapshot: () => ContainerContentsSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ContainerContentsStoreRuntime) => void;
}

export interface ContainerContentsStoreState
  extends ContainerContentsStoreSyncState {
  listeners: Set<() => void>;
  snapshot: ContainerContentsSnapshot;
  writeChain: Promise<ContainerNode | null>;
}
