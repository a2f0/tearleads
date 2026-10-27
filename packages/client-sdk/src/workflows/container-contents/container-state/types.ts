import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  ContainerDeleteResponse,
  ContainerWriterProjectionResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../../data/persistence/documents/records";
import type {
  createRemoteContainer,
  moveRemoteContainer,
  shareRemoteContainer,
} from "../../containers";
import type { createRemoteDocument } from "../../documents";
import type { shareRemoteContainerWithGroup } from "../../organizations/groupShare";
import type { CurrentPrincipalPolicyReader } from "../../principals/currentPrincipalPolicyReader";
import type { PrincipalPolicyHistoryReader } from "../../principals/principalPolicyHistoryReader";
import type {
  ContainerContentsPersistence,
  ContainerCreateIntentRecord,
  ContainerMoveIntentRecord,
} from "../containerPersistence";
import type { createInitializedContainerMetadataDocument } from "../metadata/containerMetadataDocument";
import type {
  ContainerState,
  RemoteContainer as HydratedRemoteContainer,
  RemoteContainerHydrationHost,
} from "../remoteHydration/types";
import type { ContainerContentsWorkflowRuntime } from "../runtime";

export type ContainerWorkflowApi = Parameters<
  typeof createRemoteContainer
>[0]["apiClient"] &
  Parameters<typeof shareRemoteContainer>[0]["apiClient"] &
  Parameters<typeof shareRemoteContainerWithGroup>[0]["apiClient"] &
  Parameters<typeof moveRemoteContainer>[0]["apiClient"] &
  Parameters<typeof createRemoteDocument>[0]["apiClient"] &
  Partial<PrincipalPolicyHistoryReader> &
  CurrentPrincipalPolicyReader & {
    deleteContainerResult(
      containerId: string,
      options?: {
        expectedPaymentRequiredOrganizationId?: string;
        reportErrors?: boolean;
        requiredAncestorId?: string | undefined;
      },
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
  /**
   * The metadata seed the create committed, settled by the caller instead of
   * a first metadata sync. Absent when the create carried no seed or fell back
   * to a plain create.
   */
  metadataSeed?:
    | { readonly commitLsn: string | null; readonly updateId: string }
    | undefined;
  /** The slot this client signed into the create; never the server's echo. */
  systemSlot: ContainerSystemSlot | null;
  containerId: string;
  createdAt: string;
  metadataDocumentId: string;
  organizationId: string;
  /** A created container is a child; the acknowledgement echoed this parent. */
  parentId: string;
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
  writerProjection: ContainerWriterProjectionResponse | null;
}

export interface SharedContainerState {
  container: ContainerState["container"];
  record: ContainerState["record"];
}

export type SharedContainerStateResult =
  | { status: "missing" }
  | { status: "confirmed" }
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
  /**
   * Metadata update ids this device sent, so their own update echoes are
   * classified as self-authored (shared with the metadata sync).
   */
  locallyAcceptedMetadataUpdateIds?: Set<string> | undefined;
  /** Metadata document ids of folder creates in flight (shared with hints). */
  plannedMetadataDocumentIds?: Set<string> | undefined;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
  /**
   * Verifies that a listed container is this device's pending create before it
   * is adopted and returns where it sits; `assertContainerCreateAdoptable`
   * unless a test replaces it.
   */
  verifyCreateAdoption?: (input: {
    readonly containerId: string;
    readonly expectedOrganizationId: string;
  }) => Promise<AdoptedContainerPlacement>;
}

/** Where a verified listed create committed, and where its container is now. */
export interface AdoptedContainerPlacement {
  /** The parent its signed epoch-1 `container.create` named. */
  readonly createdParentId: string;
  /** The verified head's parent; another writer may have moved it since. */
  readonly currentParentId: string;
}

export type ContainerCreateIntentSyncState = ContainerIntentSyncState;

export type ContainerCreateIntentSyncHost = Pick<
  RemoteContainerHydrationHost,
  "persistContainerState"
>;

export interface ContainerCreateIntentSyncInput {
  host: ContainerCreateIntentSyncHost;
  /** A parent whose own create has not settled takes no child create. */
  isCreatePending: (containerId: string) => boolean;
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

/** Later passes for moves the server accepted but no pass settled. */
export interface AcceptedMoveRetry {
  /** The server holds the move: schedule a replay to settle it. */
  arm: (intentId: string) => void;
  /** A replay failed; continue an accepted move's retries, if it has some. */
  resume: (intentId: string) => void;
}

export interface ContainerMoveIntentSyncInput {
  host: ContainerMoveIntentSyncHost;
  isCurrent: () => boolean;
  /** A folder whose create has not settled takes no structural writes. */
  isCreatePending: (containerId: string) => boolean;
  isRemoteSyncBlocked: (organizationId: string) => boolean;
  intent: ContainerMoveIntentRecord;
  requestRemoteReconciliation: (parentContainerId: string | null) => void;
  acceptedMoveRetry: AcceptedMoveRetry;
  state: ContainerMoveIntentSyncState;
}
