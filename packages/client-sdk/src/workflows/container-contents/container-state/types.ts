import type {
  EncapsulationKeyResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
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
} from "../containerPersistence";
import type {
  ContainerState,
  RemoteContainer as HydratedRemoteContainer,
  RemoteContainerHydrationHost,
} from "../remoteHydration";
import type { ContainerContentsWorkflowSqlRuntime } from "../runtime";

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
      | { ok: true }
      | {
          ok: false;
          report: () => void;
          status: number | null;
        }
    >;
    getEncapsulationKey(
      userId: string,
    ): Promise<EncapsulationKeyResponse | null>;
  };

export interface ContainerWorkflowRuntime
  extends ContainerContentsWorkflowSqlRuntime {
  readonly apiClient: ContainerWorkflowApi;
  readonly encapsulationKeyPair?:
    | {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      }
    | null
    | undefined;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReferencedPrincipalStateResponse[],
  ) => Promise<void>;
  readonly log: (message: string) => void;
  readonly organizationId?: string | null;
  readonly signingFingerprint?: string | null;
  readonly signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  readonly userId?: string | null;
}

export interface CreatedRemoteContainerState {
  accessManifestHash: string;
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
}

export interface SharedContainerState {
  container: ContainerState["container"];
  record: ContainerState["record"];
}

export type RemoteContainer = HydratedRemoteContainer;

export type ContainerMetadataDocumentState = Awaited<
  ReturnType<typeof createInitializedContainerMetadataDocument>
>["doc"];

export interface CreatedChildContainerState {
  containerState: ContainerState;
  initialUpdate: Uint8Array;
  shouldRequestSync: boolean;
}

export interface ContainerCreateIntentSyncState {
  containersById: ReadonlyMap<string, ContainerState>;
  persistence: ContainerContentsPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}

export type ContainerCreateIntentSyncHost = Pick<
  RemoteContainerHydrationHost,
  "persistContainerState"
>;

export interface ContainerCreateIntentSyncInput {
  host: ContainerCreateIntentSyncHost;
  intent: ContainerCreateIntentRecord;
  state: ContainerCreateIntentSyncState;
}
