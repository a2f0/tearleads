import type {
  ContainerAccessLevel,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { PurgeOptions } from "../../workflows/container-contents/container-state/purgeProgress";
import type { ContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import type { ContainerDocumentObjectSyncState } from "../../workflows/container-contents/syncState";
import type {
  ContainerContentsStoreRuntime,
  ContainerContentsStoreSyncState,
  RefreshRootLaneOptions,
} from "./syncAgentTypes";

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

// The store surface exposed through context: the snapshot fields plus the
// store's mutation/refresh methods, spelled as a Pick so the two can't drift.
export type ContainerContentsContextValue = ContainerContentsSnapshot &
  Pick<
    ContainerContentsStore,
    | "createChild"
    | "deleteContainer"
    | "emptyTrash"
    | "ensureSystemContainer"
    | "moveContainer"
    | "purgeContainer"
    | "refresh"
    | "refreshRootLane"
    | "renameContainer"
    | "requestSync"
    | "setContainerIcon"
    | "shareWithGroup"
    | "shareWithUser"
  >;

export interface ContainerContentsSnapshot {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

export type ContainerGroupRewrapPreparation =
  | {
      status: "not-granted";
    }
  | {
      isCurrent(
        expectedGroupHead: ReferencedPrincipalHead,
        expectedContainerId: string,
        expectedOrganizationId: string,
      ): Promise<boolean>;
      rewrap(): Promise<boolean>;
      status: "prepared";
    };

/**
 * Shared per-scope container tree and mutation store.
 *
 * Ordinary metadata/topology writes (`createChild`, `moveContainer`,
 * `renameContainer`, and `setContainerIcon`) commit to local persistence and
 * update subscribers before their queued remote sync converges. Destructive
 * and access-control operations retain their explicit remote-authority gates.
 */
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
  purgeContainer: (
    containerId: string,
    options?: PurgeOptions,
  ) => Promise<boolean>;
  emptyTrash: (
    trashContainerId: string,
    options?: PurgeOptions,
  ) => Promise<boolean>;
  prepareGroupRewrap: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerContentsShareAccessLevel,
    options?: { requireExistingGrant?: boolean } | undefined,
  ) => Promise<ContainerGroupRewrapPreparation | null>;
  refresh: () => Promise<boolean>;
  refreshRootLane: (options?: RefreshRootLaneOptions) => Promise<boolean>;
  // Re-read root-lane containers from local SQLite into the snapshot with NO
  // server round-trip. Surfaces a just-persisted container — e.g. the Trash bin
  // that registration/org-creation provisioned server-side and wrote to SQLite
  // via persistRegistrationBootstrap — instantly, instead of waiting for the
  // remote root-lane pull. Idempotent with a later remote pull: the merge is
  // keyed by container id, so the pull reconciles in place rather than duplicating.
  refreshLocalContainers: () => Promise<void>;
  requestSync: () => void;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
  shareWithGroup: (
    containerId: string,
    groupId: string,
    accessLevel: ContainerContentsShareAccessLevel,
    options: {
      /**
       * The display name the group was chosen by. Required: the share fails
       * closed if the verified group policy commits a different name. Signed
       * names are unique within an organization by construction (enforced at
       * group creation), so the target's own name identifies it.
       */
      expectedGroupName: string;
    },
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
