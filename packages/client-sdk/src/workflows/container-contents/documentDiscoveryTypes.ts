import type { ListContainerParentLanesRequest } from "@tearleads/validators/request";
import type {
  EffectiveAccessLevel,
  ReferencedPrincipalStateResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documents/documentSummary";

export interface ListedContainerDocument {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  effectiveAccessLevel?: EffectiveAccessLevel | undefined;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  updatedAt: string;
}

export interface ListContainerDocumentsResponse {
  hasMore: boolean;
  items: ListedContainerDocument[];
  nextWatermark: SyncWatermark | null;
  tombstones: ReadonlyArray<{
    containerId: string;
    documentId: string;
    updatedAt: string;
  }>;
}

export interface ListedContainer {
  id: string;
}

export interface ListContainersResponse {
  hasMore: boolean;
  items: ListedContainer[];
  nextWatermark: SyncWatermark | null;
}

export interface ListContainerParentLanesResponse {
  results: ReadonlyArray<{
    laneId: string;
    page: ListContainersResponse;
  }>;
}

export interface ContainerDocumentDiscoveryApi {
  readonly listContainerDocuments: (
    containerId: string,
    options?: { watermark?: SyncWatermark | null },
  ) => Promise<ListContainerDocumentsResponse | null>;
  readonly listContainerDocumentsResult?: (
    containerId: string,
    options?: { watermark?: SyncWatermark | null },
    requestOptions?: { reportErrors?: boolean | undefined },
  ) => Promise<
    | {
        readonly data: ListContainerDocumentsResponse;
        readonly ok: true;
      }
    | {
        readonly message: string;
        readonly ok: false;
        readonly report: () => void;
        readonly status: number | null;
      }
  >;
  readonly listContainerParentLanes: (
    input: ListContainerParentLanesRequest,
  ) => Promise<ListContainerParentLanesResponse | null>;
}

export interface DocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export type ContainerDocumentTombstone =
  ListContainerDocumentsResponse["tombstones"][number];

export interface DiscoverContainerDocumentsOptions {
  applyContainerDocumentTombstones: (
    tombstones: ReadonlyArray<ContainerDocumentTombstone>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
  cacheReferencedPrincipalPolicies?: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse>,
  ) => Promise<void>;
  containerId: string;
  /** Completed unwatermarked listing, published only after local apply succeeds. */
  onFullListing?: ((documentIds: ReadonlyArray<string>) => void) | undefined;
  loadContainerDocumentWatermark: (
    containerId: string,
  ) => Promise<SyncWatermark | null>;
  listContainerDocuments: ContainerDocumentDiscoveryApi["listContainerDocuments"];
  replaceDocumentLinksBatch: (
    inputs: ReadonlyArray<DocumentLinkInput>,
  ) => Promise<void>;
  saveContainerDocumentWatermark: (
    containerId: string,
    watermark: SyncWatermark,
  ) => Promise<void>;
  upsertDiscoveredDocuments: (
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
}

export interface ListedContainerDocuments {
  isFullListing: boolean;
  items: ListedContainerDocument[];
  nextWatermark: SyncWatermark | null;
  tombstones: ContainerDocumentTombstone[];
}

export interface ContainerParentDiscoveryLane {
  parentId: string | null;
  watermark: SyncWatermark | null;
}

export interface ListedContainerDocumentsLane {
  containerId: string;
  listedDocuments: ListedContainerDocuments | null;
}

export interface DiscoverAllContainerDocumentsOptions
  extends Omit<DiscoverContainerDocumentsOptions, "containerId"> {
  containerIds: ReadonlyArray<string>;
}

export interface RefreshAllContainerDocumentsOptions
  extends Omit<DiscoverAllContainerDocumentsOptions, "containerIds"> {
  listContainerParentLanes: ContainerDocumentDiscoveryApi["listContainerParentLanes"];
}

export interface RefreshAllContainerDocumentsFromApiOptions
  extends Omit<
    RefreshAllContainerDocumentsOptions,
    "listContainerDocuments" | "listContainerParentLanes"
  > {
  readonly apiClient: Pick<
    ContainerDocumentDiscoveryApi,
    | "listContainerDocuments"
    | "listContainerDocumentsResult"
    | "listContainerParentLanes"
  >;
}
