import type {
  ContainerSummary,
  ListContainersResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import type { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import type {
  ContainerContentsPersistence,
  ContainerDocumentRecord,
  ContainerRecord,
  createContainerParentSyncLane,
} from "../containerPersistence";
import type { ContainerMetadataPatch } from "../metadata";
import type { ContainerContentsWorkflowRuntime } from "../runtime";

export type ListedRemoteContainerPageItem =
  ListContainersResponse["items"][number];
export type ContainerChildIndex = Map<string, Set<string>>;
export type QueueContainerParentLane = (parentId: string | null) => void;
export type RemoteContainerIngestQueue = Map<string, RemoteContainer>;
export type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

export type ContainerMetadataDocumentState = Awaited<
  ReturnType<typeof createContainerMetadataDocument>
>;
export type RemoteContainer = Pick<
  ContainerSummary,
  | "createdAt"
  | "systemSlot"
  | "id"
  | "metadataAccessEpoch"
  | "metadataAccessStateHash"
  | "metadataDocumentId"
  | "metadataReferencedPrincipals"
  | "organizationId"
  | "parentId"
  | "updatedAt"
>;

export interface ContainerState {
  container: ContainerRecord;
  doc: ContainerMetadataDocumentState;
  record: ContainerDocumentRecord;
}

interface RemoteContainerHydrationApi {
  listContainers(options?: {
    limit?: number;
    parentId?: string | null;
    watermark?: SyncWatermark | null;
  }): Promise<ListContainersResponse | null>;
}

interface RemoteContainerHydrationRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    "auth" | "crypto" | "infra" | "state" | "util"
  > {
  apiClient: RemoteContainerHydrationApi;
}

export interface RemoteContainerHydrationState {
  containersById: Map<string, ContainerState>;
  persistence: ContainerContentsPersistence;
  runtime: RemoteContainerHydrationRuntime;
}

export interface RemoteContainerHydrationHost {
  persistContainerState: (
    containerState: ContainerState,
    patch?: Partial<ContainerMetadataPatch>,
    updateView?: boolean,
    saveOptions?: SaveContainerOptions,
  ) => Promise<ContainerDocumentRecord>;
  updateSnapshot: () => void;
}

export interface ContainerParentHydrationLane {
  parentId: string | null;
  watermark?: ListContainersResponse["nextWatermark"];
}

export interface FetchedContainerParentLanePage {
  lane: ContainerParentHydrationLane;
  response: ListContainersResponse;
  syncLane: ReturnType<typeof createContainerParentSyncLane>;
}
