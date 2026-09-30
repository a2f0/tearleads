import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { RemoteContainerHydrationState } from "./types";

/** A projection fetched ahead of sequential verification. */
export interface PrefetchedDestinationProjection {
  readonly projection: ContainerWriterProjectionResponse | null;
}

const DESTINATION_PREFETCH_CONCURRENCY = 4;

/**
 * Fetch the writer projections of newly discovered folders with bounded
 * concurrency, so a fresh device does not pay one round trip per folder in
 * series. Verification stays sequential and consumes these results. A failed
 * fetch is omitted: verification refetches and reports it.
 */
export async function prefetchDestinationProjections(input: {
  containerIds: ReadonlyArray<string>;
  isCurrent?: (() => boolean) | undefined;
  runtime: RemoteContainerHydrationState["runtime"];
}): Promise<ReadonlyMap<string, PrefetchedDestinationProjection>> {
  const prefetched = new Map<string, PrefetchedDestinationProjection>();
  const pending = [...input.containerIds];
  const fetchNext = async (): Promise<void> => {
    for (
      let containerId = pending.shift();
      containerId !== undefined && input.isCurrent?.() !== false;
      containerId = pending.shift()
    ) {
      try {
        prefetched.set(containerId, {
          projection:
            await input.runtime.apiClient.getContainerWriterProjection(
              containerId,
            ),
        });
      } catch {
        // Verification refetches this folder and reports the failure.
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(DESTINATION_PREFETCH_CONCURRENCY, pending.length) },
      fetchNext,
    ),
  );
  return prefetched;
}
