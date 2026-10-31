import type { WriterProjectionListing } from "@tearleads/api-client";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { RemoteContainerHydrationState } from "../types";

/** A projection fetched ahead of sequential verification. */
export interface PrefetchedDestinationProjection {
  readonly projection: ContainerWriterProjectionResponse | null;
}

const DESTINATION_PREFETCH_CONCURRENCY = 4;

/**
 * Fetch the writer projections of newly discovered folders with bounded
 * concurrency, so a fresh device does not pay one round trip per folder in
 * series. Verification stays sequential and consumes these results. A failed
 * fetch is omitted: verification refetches and reports it. Each folder's
 * listing places it for citation, since its row is not stored yet: the read
 * cites the listed parent's held bytes.
 */
export async function prefetchDestinationProjections(input: {
  containers: ReadonlyArray<{ readonly id: string } & WriterProjectionListing>;
  isCurrent?: (() => boolean) | undefined;
  runtime: RemoteContainerHydrationState["runtime"];
}): Promise<ReadonlyMap<string, PrefetchedDestinationProjection>> {
  const prefetched = new Map<string, PrefetchedDestinationProjection>();
  const pending = [...input.containers];
  const fetchNext = async (): Promise<void> => {
    for (
      let container = pending.shift();
      container !== undefined && input.isCurrent?.() !== false;
      container = pending.shift()
    ) {
      try {
        prefetched.set(container.id, {
          projection:
            await input.runtime.apiClient.getContainerWriterProjection(
              container.id,
              {
                organizationId: container.organizationId,
                parentId: container.parentId,
              },
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
