import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type {
  ContainerDeleteResponse,
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@symcrypt/validators/response";
import type { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../../data/sqlite/documentPersistence";
import type {
  createRemoteContainer,
  moveRemoteContainer,
  shareRemoteContainer,
  shareRemoteContainerWithGroup,
} from "../../containers";
import type { createRemoteDocument } from "../../documents";
import type {
  ContainerContentsPersistence,
  ContainerCreateIntentRecord,
  ContainerMoveIntentRecord,
} from "../containerPersistence";
import type {
  ContainerState,
  RemoteContainer as HydratedRemoteContainer,
  RemoteContainerHydrationHost,
} from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";

export type ContainerWorkflowApi = Parameters<
  typeof createRemoteContainer
>[0]["apiClient"] &
  Parameters<typeof shareRemoteContainer>[0]["apiClient"] &
  Parameters<typeof shareRemoteContainerWithGroup>[0]["apiClient"] &
  Parameters<typeof moveRemoteContainer>[0]["apiClient"] &
  Parameters<typeof createRemoteDocument>[0]["apiClient"] & {
    deleteContainerResult(
      containerId: string,
      options?: { reportErrors?: boolean },
    ): Promise<
      | { data: ContainerDeleteResponse; ok: true }
      | {
          ok: false;
          report: () => void;
          status: number | null;
        }
    >;
    primeContainerWriterProjection(
      containerId: string,
      projection: ContainerWriterProjectionResponse,
    ): void;
    getCurrentPrincipalPolicy(
      principalType: "group" | "organization",
      principalId: string,
    ): Promise<PrincipalPolicyBundleResponse | null>;
  };

export interface ContainerWorkflowRuntime
  extends Pick<
    ContainerContentsWorkflowRuntime,
    | "auth"
    | "crypto"
    | "infra"
    | "resolveTrustedUserIdentity"
    | "state"
    | "util"
  > {
  readonly apiClient: ContainerWorkflowApi;
}

export interface CreatedRemoteContainerState {
  accessManifestHash: string;
  systemSlot?: ContainerSystemSlot | null;
  containerId: string;
  createdAt: string;
  metadataDocumentId: string;
  organizationId: string;
  parentId: string | null;
  persistedMetadataState: Pick<
    DocumentRecord,
    | "documentId"
    | "contentKeyBundle"
    | "documentKekTargets"
    | "documentManifestBundle"
  >;
  updatedAt: string;
}

export interface SharedRemoteContainerState {
  accessEpoch: number;
  accessManifestHash: string;
  createdAt: string;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReferencedPrincipalStateResponse[];
  updatedAt: string;
  writerProjection: ContainerWriterProjectionResponse;
}

export interface SharedContainerState {
  container: ContainerState["container"];
  record: ContainerState["record"];
}

export type SharedContainerStateResult =
  | { status: "missing" }
  | (SharedContainerState & {
      status: "identity-superseded" | "persisted";
    });

export type RemoteContainer = HydratedRemoteContainer;

export type ContainerMetadataDocumentState = Awaited<
  ReturnType<typeof createInitializedContainerMetadataDocument>
>["doc"];

export interface CreatedChildContainerState {
  containerState: ContainerState;
  initialUpdate: Uint8Array;
  shouldRequestSync: boolean;
}

export interface ContainerIntentSyncState {
  containersById: ReadonlyMap<string, ContainerState>;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}

export type ContainerCreateIntentSyncState = ContainerIntentSyncState;

export type ContainerCreateIntentSyncHost = Pick<
  RemoteContainerHydrationHost,
  "persistContainerState"
>;

export interface ContainerCreateIntentSyncInput {
  host: ContainerCreateIntentSyncHost;
  isCurrent: () => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  intent: ContainerCreateIntentRecord;
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
  state: ContainerCreateIntentSyncState;
}

export type ContainerMoveIntentSyncState = ContainerIntentSyncState;

export type ContainerMoveIntentSyncHost = Pick<
  RemoteContainerHydrationHost,
  "persistContainerState" | "updateSnapshot"
>;

export interface ContainerMoveIntentSyncInput {
  host: ContainerMoveIntentSyncHost;
  isCurrent: () => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  intent: ContainerMoveIntentRecord;
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
  state: ContainerMoveIntentSyncState;
}
