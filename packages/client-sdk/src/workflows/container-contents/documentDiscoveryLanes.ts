import type { DocumentSummary } from "../../data/documents/documentSummary";
import { listContainerDocumentsFromWatermarks } from "./containerDocumentListing";
import {
  applyListedContainerDocuments,
  type ContainerDocumentDiscoveryLane,
} from "./documentDiscoveryApply";
import type {
  ContainerDocumentLaneLister,
  DiscoverContainerDocumentsOptions,
  ListedContainerDocuments,
} from "./documentDiscoveryTypes";

export type { ContainerDocumentDiscoveryLane } from "./documentDiscoveryApply";

export type ContainerDocumentDiscoveryOutcome =
  | {
      readonly containerId: string;
      readonly status: "fulfilled";
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

async function applyListedLane(
  lane: ContainerDocumentDiscoveryLane,
  generation: number,
  listedDocuments: ListedContainerDocuments | null,
): Promise<ContainerDocumentDiscoveryOutcome> {
  try {
    return {
      containerId: lane.containerId,
      status: "fulfilled",
      value: listedDocuments
        ? await applyListedContainerDocuments(lane, generation, listedDocuments)
        : null,
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
  /** Awaited after each lane settles, before the next lane applies. */
  readonly onOutcome?: ContainerDocumentDiscoveryOutcomeHandler | undefined;
}): Promise<ReadonlyArray<ContainerDocumentDiscoveryOutcome>> {
  if (input.lanes.length === 0) return [];
  let listed: Awaited<ReturnType<typeof listContainerDocumentsFromWatermarks>>;
  try {
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
    const outcome = await applyListedLane(
      lane,
      input.generation,
      listed.get(lane.containerId) ?? null,
    );
    outcomes.push(outcome);
    await input.onOutcome?.(outcome);
  }
  return outcomes;
}
