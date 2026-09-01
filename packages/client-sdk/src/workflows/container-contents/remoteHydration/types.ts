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
  ContainerHydrationTombstone,
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
  /** Durable pull progress mirrored from the metadata document record. */
  pullContinuation?: ContainerDocumentRecord["pullContinuation"] | undefined;
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
  lifecycleGeneration?: number | undefined;
  persistence: ContainerContentsPersistence;
  rootLaneHydrated?: boolean | undefined;
  runtime: RemoteContainerHydrationRuntime;
}

export type PersistContainerStateResult =
  | { status: "identity-superseded"; record: ContainerDocumentRecord }
  | { status: "missing" }
  | { status: "persisted"; record: ContainerDocumentRecord }
  | { status: "stale-generation" };

export interface RemoteContainerHydrationHost {
  persistContainerState: (
    containerState: ContainerState,
    patch?: Partial<ContainerMetadataPatch>,
    updateView?: boolean,
    saveOptions?: SaveContainerOptions,
    mutationOptions?: {
      expectedStateWhenMissing?: ContainerState | undefined;
      isCurrent?: (() => boolean) | undefined;
      createIntentSettlement?: Parameters<
        ContainerContentsPersistence["commitMetadataMutation"]
      >[1]["createIntentSettlement"];
      moveIntentSettlement?: Parameters<
        ContainerContentsPersistence["commitMetadataMutation"]
      >[1]["moveIntentSettlement"];
      preserveDurableStructureWhenPending?: boolean | undefined;
    },
  ) => Promise<PersistContainerStateResult>;
  requestDocumentPriming?: (() => void) | undefined;
  updateSnapshot: () => void;
}

export interface ContainerParentHydrationLane {
  parentId: string | null;
  watermark?: ListContainersResponse["nextWatermark"];
}

export interface ExpectedContainerState {
  container: ContainerRecord;
  fingerprint: string;
}

export interface FetchedContainerParentLanePage {
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>;
  expectedHydrationTombstones: ReadonlyMap<string, ContainerHydrationTombstone>;
  lane: ContainerParentHydrationLane;
  response: ListContainersResponse;
  syncLane: ReturnType<typeof createContainerParentSyncLane>;
}
