import type { ContainerAccessLevel } from "@tearleads/crypto";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerDocumentObjectSyncState } from "../../workflows/container-contents/syncState";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
} from "./syncAgent";

// Reuse the canonical access-level union from the crypto layer (the same source
// `ContainerShareAccessLevel` chains to) rather than re-spelling the literals,
// so the two can't drift.
export type ContainerContentsShareAccessLevel = ContainerAccessLevel;

export interface ContainerContentsStoreOptions {
  logLabel?: string | undefined;
  persistence?: ContainerContentsPersistence | undefined;
}

export interface ContainerNode {
  systemSlot?: ContainerSystemSlot | null;
  createdAt?: string | null;
  effectiveAccessLevel?: ContainerAccessLevel | undefined;
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
    options?: EnsureSystemContainerOptions | undefined,
  ) => Promise<ContainerNode | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  purgeContainer: (containerId: string) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  refreshRootLane: () => Promise<boolean>;
  requestSync: () => void;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerContentsShareAccessLevel,
    options?: { requireExistingGrant?: boolean } | undefined,
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
    options?: EnsureSystemContainerOptions | undefined,
  ) => Promise<ContainerNode | null>;
  moveContainer: (
    containerId: string,
    parentId: string,
  ) => Promise<ContainerNode | null>;
  purgeContainer: (containerId: string) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  refreshRootLane: () => Promise<boolean>;
  requestSync: () => void;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerContentsShareAccessLevel,
    options?: { requireExistingGrant?: boolean } | undefined,
  ) => Promise<boolean>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  getCachedContainerWriterProjection: (
    containerId: string,
  ) => ContainerWriterProjectionResponse | null;
  getSnapshot: () => ContainerContentsSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ContainerContentsStoreRuntime) => void;
}

export interface EnsureSystemContainerOptions {
  icon?: string | null | undefined;
  skipAdvancedManagedRoot?: boolean | undefined;
  // For local-first bootstrap paths where slow remote I/O must not block the
  // caller from creating the deterministic local system container.
  deferRemoteBootstrap?: boolean | undefined;
  // Create the deterministic local system container without queuing the remote
  // create. A later ensureSystemContainer call without this flag promotes the
  // local slot into the sync queue.
  deferRemoteSync?: boolean | undefined;
}

export interface ContainerContentsStoreState
  extends ContainerContentsStoreSyncState {
  listeners: Set<() => void>;
  snapshot: ContainerContentsSnapshot;
  writeChain: Promise<ContainerNode | null>;
}
