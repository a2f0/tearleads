import type {
  ListContainerDocumentLanesRequest,
  ListContainerParentLanesRequest,
} from "@tearleads/validators/request";
import type {
  EffectiveAccessLevel,
  ReferencedPrincipalStateResponse,
  SyncWatermark,
} from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../../data/documents/documentSummary";
import type { DiscoveredDocumentCandidate } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import type { ListedDocumentHead } from "../../documents";

export interface ListedContainerDocument {
  createdAt: string;
  currentAccessEpoch: number;
  currentAccessStateHash: string;
  effectiveAccessLevel?: EffectiveAccessLevel | undefined;
  id: string;
  linkedContainerIds: string[];
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  /** How many updates the server holds for the document. */
  updateCount: number;
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

export type ContainerDocumentLaneResult =
  | { readonly laneId: string; readonly page: ListContainerDocumentsResponse }
  | {
      readonly failure: { readonly code?: string | undefined };
      readonly laneId: string;
    };

export interface ContainerDocumentDiscoveryApi {
  readonly listContainerDocumentLanes: (
    input: ListContainerDocumentLanesRequest,
    options?: { readonly reportErrors?: boolean | undefined },
  ) => Promise<{
    readonly results: ReadonlyArray<ContainerDocumentLaneResult>;
  } | null>;
  readonly listContainerParentLanes: (
    input: ListContainerParentLanesRequest,
  ) => Promise<ListContainerParentLanesResponse | null>;
}

/**
 * One page per lane, aligned with the requested lanes: `null` for a lane the
 * server rejected, or `null` overall when the request itself failed.
 */
export type ContainerDocumentLaneLister = (
  lanes: ReadonlyArray<{
    readonly containerId: string;
    readonly watermark: SyncWatermark | null;
  }>,
) => Promise<ReadonlyArray<ListContainerDocumentsResponse | null> | null>;

export interface DocumentLinkInput {
  accessEpoch?: number | undefined;
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export type ContainerDocumentTombstone =
  ListContainerDocumentsResponse["tombstones"][number];

export interface VerifiedContainerDocumentTombstone
  extends ContainerDocumentTombstone {
  /** The verified head's link-set epoch, not below the local document epoch. */
  readonly accessEpoch: number;
  /** The verified head link set; it omits `containerId`. */
  readonly linkedContainerIds: ReadonlyArray<string>;
}

/**
 * What the document's signed head says about a listing tombstone.
 * - `verified`: the verified head link set omits the container; apply.
 * - `refuted`: the verified head still links the container; keep visible and retry.
 * - `unverified`: no verified head is available; hold, hide, retry later.
 * - `deferred`: not attempted this run (the per-run head-load cap); hold
 *   without counting an attempt, so the retry backoff does not grow.
 */
export type ContainerDocumentTombstoneVerdict =
  | {
      readonly kind: "verified";
      readonly tombstone: VerifiedContainerDocumentTombstone;
    }
  | {
      readonly kind: "refuted";
      /** The verified head link set, which contains the container. */
      readonly linkedContainerIds: ReadonlyArray<string>;
      readonly tombstone: ContainerDocumentTombstone;
    }
  | {
      readonly kind: "unverified";
      readonly tombstone: ContainerDocumentTombstone;
    }
  | {
      readonly kind: "deferred";
      readonly tombstone: ContainerDocumentTombstone;
    };

export interface HeldContainerDocumentTombstoneInput
  extends ContainerDocumentTombstone {
  /** Held without a verification attempt; the backoff does not advance. */
  readonly deferred?: boolean | undefined;
  /** A verified head still links it; retry the tombstone while keeping it visible. */
  readonly refuted?: boolean | undefined;
}

export type ContainerDocumentTombstoneVerifier = (
  tombstones: ReadonlyArray<ContainerDocumentTombstone>,
) => Promise<ReadonlyArray<ContainerDocumentTombstoneVerdict>>;

export type ContainerDocumentPlacement = Pick<
  ContainerDocumentTombstone,
  "containerId" | "documentId"
>;

export interface ContainerDocumentTombstoneHoldStore {
  holdContainerDocumentTombstones: (
    tombstones: ReadonlyArray<HeldContainerDocumentTombstoneInput>,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<void>;
  /** Held tombstones on these containers that are due for another attempt. */
  listHeldContainerDocumentTombstones: (
    containerIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<ContainerDocumentTombstone>>;
  /** The subset of placements that exist locally (link row or primary). */
  listKnownContainerDocumentPlacements: (
    placements: ReadonlyArray<ContainerDocumentPlacement>,
  ) => Promise<ReadonlyArray<ContainerDocumentPlacement>>;
  refuteContainerDocumentTombstoneHolds: (
    placements: ReadonlyArray<ContainerDocumentPlacement>,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<void>;
}

export interface DiscoverContainerDocumentsOptions
  extends ContainerDocumentTombstoneHoldStore {
  applyContainerDocumentTombstones: (
    tombstones: ReadonlyArray<VerifiedContainerDocumentTombstone>,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
  verifyContainerDocumentTombstones: ContainerDocumentTombstoneVerifier;
  /** Allocate durable local order before fetching a listing. */
  beginDocumentDiscovery: () => Promise<number>;
  /** Persist pending candidates and return only signed placements. */
  verifyDiscoveredDocuments: (
    inputs: ReadonlyArray<DiscoveredDocumentCandidate>,
    containerIds: ReadonlyArray<string>,
    generation: number,
    tombstones?: ReadonlyArray<ContainerDocumentTombstone>,
    conflictingDocumentIds?: ReadonlySet<string>,
  ) => Promise<{
    inputs: ReadonlyArray<DiscoveredDocumentInput>;
    /** False once a remote trust reset cancels this listing pass. */
    isCurrent: () => Promise<boolean>;
    /** Acknowledge only after local apply; true means no pending candidates remain. */
    commit: () => Promise<boolean>;
  }>;
  cacheReferencedPrincipalPolicies?: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse>,
  ) => Promise<void>;
  /**
   * Owe a read, durably, to each listed document this device holds behind
   * the listing, by update count or by access head, and return the documents
   * owed. It runs before the listed rows are applied, and a lane's watermark
   * may pass a row only after it ran for that row: an opened document is not
   * probed on its own, so the debt is what recovers an edit or an access
   * change whose hint was lost.
   */
  oweListedDocumentReads: (
    listed: ReadonlyArray<ListedDocumentHead>,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<ReadonlyArray<string>>;
  /** The documents a listing just owed a read, once their debts are durable. */
  onDocumentReadsOwed?:
    | ((documentIds: ReadonlyArray<string>) => void)
    | undefined;
  containerId: string;
  /** Completed unwatermarked listing, published only after local apply succeeds. */
  onFullListing?: ((documentIds: ReadonlyArray<string>) => void) | undefined;
  loadContainerDocumentWatermark: (
    containerId: string,
  ) => Promise<SyncWatermark | null>;
  listContainerDocumentLanes: ContainerDocumentLaneLister;
  /** Recheck stillCurrent under the mutation lock before persisting a listing. */
  replaceDocumentLinksBatch: (
    inputs: ReadonlyArray<DocumentLinkInput>,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<void>;
  saveContainerDocumentWatermark: (
    containerId: string,
    watermark: SyncWatermark,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<void>;
  upsertDiscoveredDocuments: (
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
    stillCurrent: () => Promise<boolean>,
  ) => Promise<ReadonlyArray<DocumentSummary>>;
}

export interface ListedContainerDocuments {
  isFullListing: boolean;
  items: ListedContainerDocument[];
  nextWatermark: SyncWatermark | null;
  tombstones: ContainerDocumentTombstone[];
}

/**
 * One lane's listing: complete; `null` when the server refused the lane or a
 * continuation came back without a watermark; or `"unavailable"` when the
 * batched request carrying it failed or timed out, which says nothing about
 * the lane and is worth retrying.
 */
export type ContainerDocumentLaneListing =
  | ListedContainerDocuments
  | "unavailable"
  | null;

/**
 * Discovery could not list the container because its listing request failed
 * or timed out. Unlike a refused lane, a later attempt may succeed, so the
 * reconciler treats it as a failed reconciliation, not a skipped one.
 */
export class ContainerDocumentListingUnavailableError extends Error {
  constructor(readonly containerId: string) {
    super(`Document listing for container ${containerId} is unavailable`);
    this.name = "ContainerDocumentListingUnavailableError";
  }
}
