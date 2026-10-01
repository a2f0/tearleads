import { withMetadataRootReload } from "../../organizations/groupMetadataErrors";

/**
 * Reads a destination again once when its metadata root was behind the
 * directory. A prefetched projection is that same stale root, so the reread
 * drops it and fetches after `evictRoot` clears the cached one.
 */
export function resolveWithMetadataRootReload<
  Input extends { readonly prefetchedProjection?: unknown },
  Result,
>(
  input: Input,
  resolve: (input: Input) => Promise<Result>,
  evictRoot: () => void,
): Promise<Result> {
  return withMetadataRootReload(
    (reread) =>
      resolve(reread ? { ...input, prefetchedProjection: undefined } : input),
    evictRoot,
  );
}
