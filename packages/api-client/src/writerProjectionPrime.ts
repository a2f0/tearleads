import type { BoundedCache } from "./ApiCache";

/**
 * Seed a writer-projection cache slot from a projection the client just
 * authored, so the next read resolves locally instead of a cold GET. The seed
 * must describe the id it is primed under — checked with the same binding a
 * fetched response must satisfy, since a seed is built from mutation-response
 * material and a projection for another object would make that next read, and
 * the wrap it feeds, land on the wrong container or document. It never
 * clobbers an existing entry (a fetch in flight or an earlier prime). The
 * just-authored seed supersedes any GET already in flight: dropping the shared
 * result entry makes a post-prime result caller read the seed instead of
 * coalescing onto the older fetch. Callers already holding that fetch keep
 * their result, and its settle cannot clobber the seed because the slot no
 * longer matches its snapshot.
 */
export function primeWriterProjectionSlot<T>(input: {
  readonly cache: BoundedCache<Promise<T | null>>;
  readonly describes: (value: unknown) => value is T;
  readonly id: string;
  readonly inFlightResults: { delete(key: string): boolean };
  readonly label: string;
  readonly projection: T;
}): void {
  if (!input.describes(input.projection)) {
    throw new Error(
      `${input.label} writer projection prime does not describe ${input.id}`,
    );
  }
  if (input.cache.has(input.id)) {
    return;
  }
  input.cache.set(input.id, Promise.resolve(input.projection));
  input.inFlightResults.delete(input.id);
}
