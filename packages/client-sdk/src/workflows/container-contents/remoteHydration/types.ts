import type { ListContainerParentLanesRequest } from "@symcrypt/validators/request";
import type {
  ContainerSummary,
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
  ListContainerParentLanesResponse,
  ListContainersResponse,
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@symcrypt/validators/response";
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
  | "effectiveAccessLevel"
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
  containerWriterProjection?:
    | ContainerWriterProjectionResponse
    | null
    | undefined;
  metadataReferencedPrincipals?:
    | readonly ReferencedPrincipalStateResponse[]
    | undefined;
  container: ContainerRecord;
  doc: ContainerMetadataDocumentState;
  metadataWriterProjection?:
    | DocumentWriterProjectionResponse
    | null
    | undefined;
  record: ContainerDocumentRecord;
}

interface RemoteContainerHydrationApi {
  getCurrentPrincipalPolicy(
    principalType: "group" | "organization",
    principalId: string,
  ): Promise<PrincipalPolicyBundleResponse | null>;
  listContainerParentLanes(
    input: ListContainerParentLanesRequest,
  ): Promise<ListContainerParentLanesResponse | null>;
}

interface RemoteContainerHydrationRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "adoptRootContainer"
    | "crypto"
    | "infra"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  apiClient: RemoteContainerHydrationApi;
}

export interface RemoteContainerHydrationState {
  containersById: Map<string, ContainerState>;
  persistence: ContainerContentsPersistence;
  rootLaneHydrated?: boolean | undefined;
  runtime: RemoteContainerHydrationRuntime;
}

export interface RemoteContainerHydrationHost {
  persistContainerState: (
    containerState: ContainerState,
    patch?: Partial<ContainerMetadataPatch>,
    updateView?: boolean,
    saveOptions?: SaveContainerOptions,
  ) => Promise<ContainerDocumentRecord>;
  requestDocumentPriming?: (() => void) | undefined;
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
