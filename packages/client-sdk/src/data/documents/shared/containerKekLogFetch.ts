import type {
  ContainerKekLogEpochResponse,
  ContainerKekLogResponse,
} from "@tearleads/validators/response";
import {
  CONTAINER_KEK_LOG_PAGE_LIMIT,
  MAX_CONTAINER_KEY_EPOCH,
} from "@tearleads/validators/util";
import type { AggregatedContainerKekLog } from "./keyringLogWalk";

/**
 * Binds one page to what was actually asked for.
 *
 * Every page is checked, not just the last: the aggregate is handed to a
 * rebuild that trusts its shape, so a page for another container — or one
 * replaying epochs at or below the cursor — would splice foreign or duplicate
 * history into the walk before any commitment check could notice the ordering
 * was wrong.
 */
function assertLogPageMatchesRequest(
  page: {
    containerId: string;
    epochs: readonly { containerKeyEpoch: number }[];
  },
  containerId: string,
  afterKeyEpoch: number,
): void {
  if (page.containerId !== containerId) {
    throw new Error("Container KEK log page is for the wrong container");
  }
  let previousKeyEpoch = afterKeyEpoch;
  for (const epoch of page.epochs) {
    if (epoch.containerKeyEpoch <= previousKeyEpoch) {
      throw new Error("Container KEK log page is out of order");
    }
    previousKeyEpoch = epoch.containerKeyEpoch;
  }
}

/**
 * Fetches the container's complete rotation log across pages. The endpoint
 * bounds each page, so a long-lived container needs several round trips; the
 * cursor is the last served epoch number.
 */
export async function fetchContainerKekLog(input: {
  apiClient: {
    getContainerKekLog(
      containerId: string,
      options?: {
        readonly afterKeyEpoch?: number;
        readonly keyringForEpoch?: number;
      },
    ): Promise<ContainerKekLogResponse | null>;
  };
  containerId: string;
  /** Ask for one historical keyring by epoch number; blobs are never bulk. */
  keyringForEpoch?: number | undefined;
}): Promise<AggregatedContainerKekLog> {
  const epochs: ContainerKekLogEpochResponse[] = [];
  let afterKeyEpoch = 0;
  // A hostile server could claim `hasMore` forever. Two independent caps
  // bound the walk: the protocol's lifetime rotation ceiling, and a page
  // budget — a server that advances one epoch per page cannot force 65,536
  // round trips, because a non-final page must be full.
  const maxPages =
    Math.ceil(MAX_CONTAINER_KEY_EPOCH / CONTAINER_KEK_LOG_PAGE_LIMIT) + 1;
  let pages = 0;
  while (afterKeyEpoch < MAX_CONTAINER_KEY_EPOCH) {
    pages += 1;
    if (pages > maxPages) {
      throw new Error("Container KEK log exceeds its page budget");
    }
    const page = await input.apiClient.getContainerKekLog(input.containerId, {
      afterKeyEpoch,
      ...(input.keyringForEpoch === undefined
        ? {}
        : { keyringForEpoch: input.keyringForEpoch }),
    });
    if (!page) {
      throw new Error("Container KEK log is unavailable");
    }
    if (page.hasMore && page.epochs.length < CONTAINER_KEK_LOG_PAGE_LIMIT) {
      // Only the final page may be short; a partial page claiming more is a
      // server stretching the walk across extra round trips.
      throw new Error("Container KEK log page is short but claims more");
    }
    assertLogPageMatchesRequest(page, input.containerId, afterKeyEpoch);
    epochs.push(...page.epochs);
    if (epochs.length > MAX_CONTAINER_KEY_EPOCH) {
      throw new Error("Container KEK log exceeds the maximum key epoch");
    }
    const lastEpoch = page.epochs.at(-1)?.containerKeyEpoch;
    // Validate before returning, so a final page cannot smuggle an
    // out-of-range epoch past the ceiling check.
    if (lastEpoch !== undefined && lastEpoch > MAX_CONTAINER_KEY_EPOCH) {
      throw new Error("Container KEK log exceeds the maximum key epoch");
    }
    if (!page.hasMore) {
      return { containerId: page.containerId, epochs };
    }
    if (lastEpoch === undefined || lastEpoch <= afterKeyEpoch) {
      throw new Error("Container KEK log page did not advance");
    }
    afterKeyEpoch = lastEpoch;
  }
  throw new Error("Container KEK log exceeds the maximum key epoch");
}
