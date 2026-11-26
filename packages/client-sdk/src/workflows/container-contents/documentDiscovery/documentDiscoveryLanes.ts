import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { listContainerDocumentsFromWatermarks } from "./containerDocumentListing";
import {
  applyListedContainerDocuments,
  type ContainerDocumentDiscoveryLane,
} from "./documentDiscoveryApply";
import {
  type ContainerDocumentLaneLister,
  type ContainerDocumentLaneListing,
  ContainerDocumentListingUnavailableError,
  type DiscoverContainerDocumentsOptions,
} from "./documentDiscoveryTypes";

export type { ContainerDocumentDiscoveryLane } from "./documentDiscoveryApply";

export type ContainerDocumentDiscoveryOutcome =
  | {
      readonly containerId: string;
      readonly status: "fulfilled";
      /**
       * The server refused the lane, it was never sent, or its apply was
       * superseded: its watermark may not have moved, so it says nothing
       * about the documents it holds.
       */
      readonly unlisted?: true | undefined;
      /** `null` when the lane was not fully listed or nothing applied. */
      readonly value: ReadonlyArray<DocumentSummary> | null;
    }
  | {
      readonly containerId: string;
      readonly reason: unknown;
      readonly status: "rejected";
    };

/** Lets a caller act on each lane before later lanes apply. */
export type ContainerDocumentDiscoveryOutcomeHandler = (
  outcome: ContainerDocumentDiscoveryOutcome,
) => Promise<void>;

/** One lane's listing request a tree listing owed, read before the listing. */
export interface OwedContainerDocumentLaneListing {
  readonly containerId: string;
  readonly revision: string;
}

/**
 * Applies one lane's listing. With `owed`, a listing that applied with no
 * candidate left pending settles that request; a listing that was refused,
 * superseded or left candidates pending leaves the lane owed.
 */
async function applyListedLane(
  lane: ContainerDocumentDiscoveryLane,
  generation: number,
  listedDocuments: ContainerDocumentLaneListing,
  settleOwed: (() => Promise<void>) | undefined,
): Promise<ContainerDocumentDiscoveryOutcome> {
  // A failed request is retryable, unlike a refused lane: reject it so the
  // caller retries and reports it rather than settling as if nothing changed.
  if (listedDocuments === "unavailable") {
    return {
      containerId: lane.containerId,
      reason: new ContainerDocumentListingUnavailableError(lane.containerId),
      status: "rejected",
    };
  }
  try {
    if (!listedDocuments) {
      return {
        containerId: lane.containerId,
        status: "fulfilled",
        unlisted: true,
        value: null,
      };
    }
    const applied = await applyListedContainerDocuments(
      lane,
      generation,
      listedDocuments,
    );
    if (applied.status === "applied" && applied.settled) await settleOwed?.();
    return applied.status === "superseded"
      ? {
          containerId: lane.containerId,
          status: "fulfilled",
          unlisted: true,
          value: null,
        }
      : {
          containerId: lane.containerId,
          status: "fulfilled",
          value: applied.documents,
        };
  } catch (reason) {
    return { containerId: lane.containerId, reason, status: "rejected" };
  }
}

/**
 * Discovers several containers with one batched listing, then verifies and
 * applies each lane on its own, in order. The generation must be captured
 * before any lane's scope was read, exactly as for a single discovery: every
 * listing in the batch starts after it, so a reset in between still cancels
 * the batch. One lane's failure never blocks applying the others.
 */
export async function discoverContainerDocumentLanes(input: {
  readonly generation: number;
  readonly lanes: ReadonlyArray<ContainerDocumentDiscoveryLane>;
  readonly listContainerDocumentLanes: ContainerDocumentLaneLister;
  readonly loadContainerDocumentWatermark: DiscoverContainerDocumentsOptions["loadContainerDocumentWatermark"];
  /**
   * The listing requests owed to these lanes. Read before the listing is
   * sent: a listing answers only what was owed before it began.
   */
  readonly loadOwedLaneListings?:
    | ((
        containerIds: ReadonlyArray<string>,
      ) => Promise<ReadonlyArray<OwedContainerDocumentLaneListing>>)
    | undefined;
  /** Awaited after each lane settles, before the next lane applies. */
  readonly onOutcome?: ContainerDocumentDiscoveryOutcomeHandler | undefined;
  /** Settles a request that a settled listing answered. */
  readonly settleOwedLaneListing?:
    | ((owed: OwedContainerDocumentLaneListing) => Promise<void>)
    | undefined;
}): Promise<ReadonlyArray<ContainerDocumentDiscoveryOutcome>> {
  if (input.lanes.length === 0) return [];
  let listed: Awaited<ReturnType<typeof listContainerDocumentsFromWatermarks>>;
  const owedByContainerId = new Map<string, OwedContainerDocumentLaneListing>();
  try {
    const containerIds = input.lanes.map((lane) => lane.containerId);
    for (const owed of (await input.loadOwedLaneListings?.(containerIds)) ??
      []) {
      owedByContainerId.set(owed.containerId, owed);
    }
    listed = await listContainerDocumentsFromWatermarks({
      containerIds: input.lanes.map((lane) => lane.containerId),
      listContainerDocumentLanes: input.listContainerDocumentLanes,
      loadContainerDocumentWatermark: input.loadContainerDocumentWatermark,
    });
  } catch (reason) {
    const rejected = input.lanes.map(
      ({ containerId }): ContainerDocumentDiscoveryOutcome => ({
        containerId,
        reason,
        status: "rejected",
      }),
    );
    for (const outcome of rejected) await input.onOutcome?.(outcome);
    return rejected;
  }

  const outcomes: ContainerDocumentDiscoveryOutcome[] = [];
  for (const lane of input.lanes) {
    const owed = owedByContainerId.get(lane.containerId);
    const settleOwedLaneListing = input.settleOwedLaneListing;
    const outcome = await applyListedLane(
      lane,
      input.generation,
      listed.get(lane.containerId) ?? null,
      owed && settleOwedLaneListing
        ? () => settleOwedLaneListing(owed)
        : undefined,
    );
    outcomes.push(outcome);
    await input.onOutcome?.(outcome);
  }
  return outcomes;
}
