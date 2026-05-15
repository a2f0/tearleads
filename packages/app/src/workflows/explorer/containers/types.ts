import type {
  EncapsulationKeyResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import type { createInitializedContainerMetadataDocument } from "../../../data/containers";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { DocumentRecord } from "../../../data/sqlite/documentPersistence";
import type {
  createRemoteContainer,
  moveRemoteContainer,
  shareRemoteContainer,
} from "../../containers";
import type { createRemoteDocument } from "../../documents";
import type {
  ContainerCreateIntentRecord,
  ExplorerPersistence,
} from "../containerPersistence";
import type {
  ExplorerContainerState,
  ExplorerRemoteContainer,
  ExplorerRemoteContainerHydrationHost,
} from "../remoteHydration";
import type { ExplorerWorkflowSqlRuntime } from "../runtime";

export type ExplorerContainerWorkflowApi = Parameters<
  typeof createRemoteContainer
>[0]["apiClient"] &
  Parameters<typeof shareRemoteContainer>[0]["apiClient"] &
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

export interface ExplorerContainerWorkflowRuntime
  extends ExplorerWorkflowSqlRuntime {
  apiClient: ExplorerContainerWorkflowApi;
  encapsulationKeyPair?:
    | {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      }
    | null
    | undefined;
  cacheReferencedPrincipalPolicies: (
    references: ReferencedPrincipalStateResponse[],
  ) => Promise<void>;
  log: (message: string) => void;
  organizationId?: string | null;
  signingFingerprint?: string | null;
  signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  userId?: string | null;
}

export interface CreatedExplorerContainer {
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

export interface SharedExplorerContainer {
  accessEpoch: number;
  accessManifestHash: string;
  createdAt: string;
  metadataDocumentId: string;
  referencedPrincipalHeads: ReferencedPrincipalStateResponse[];
  updatedAt: string;
}

export interface SharedExplorerContainerState {
  container: ExplorerContainerState["container"];
  record: ExplorerContainerState["record"];
}

export type RemoteExplorerContainer = ExplorerRemoteContainer;

export type ExplorerContainerMetadataDocument = Awaited<
  ReturnType<typeof createInitializedContainerMetadataDocument>
>["doc"];

export interface CreatedExplorerChildContainer {
  containerState: ExplorerContainerState;
  initialUpdate: Uint8Array;
  shouldEnqueueInitialUpdate: boolean;
}

export interface ExplorerContainerCreateIntentSyncState {
  containersById: ReadonlyMap<string, ExplorerContainerState>;
  persistence: ExplorerPersistence;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ExplorerContainerWorkflowRuntime;
}

export type ExplorerContainerCreateIntentSyncHost = Pick<
  ExplorerRemoteContainerHydrationHost,
  "persistContainerState"
>;

export interface ExplorerContainerCreateIntentSyncInput {
  host: ExplorerContainerCreateIntentSyncHost;
  intent: ContainerCreateIntentRecord;
  state: ExplorerContainerCreateIntentSyncState;
}
