import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { MetadataRootBehindDirectoryError } from "../../organizations/groupMetadataErrors";
import { resolveWithMetadataRootReload } from "./destinationRootReload";

interface ResolveInput {
  readonly prefetchedProjection?: string | undefined;
}

function staleRootResolver(staleReads: number) {
  const reads: (string | undefined)[] = [];
  const resolve = async (input: ResolveInput) => {
    reads.push(input.prefetchedProjection);
    if (reads.length <= staleReads) {
      throw new MetadataRootBehindDirectoryError();
    }
    return "verified-role";
  };
  return { reads, resolve };
}

test("a stale prefetched root is reread from the server, not reused", async () => {
  const { reads, resolve } = staleRootResolver(1);
  let evictions = 0;

  await expect(
    resolveWithMetadataRootReload(
      { prefetchedProjection: "stale-prefetched-root" },
      resolve,
      () => {
        evictions += 1;
      },
    ),
  ).resolves.toBe("verified-role");
  expect(reads).toEqual(["stale-prefetched-root", undefined]);
  expect(evictions).toBe(1);
});

test("a destination root still behind after the reread is an incident", async () => {
  const { reads, resolve } = staleRootResolver(2);

  await expect(
    resolveWithMetadataRootReload(
      { prefetchedProjection: "stale-prefetched-root" },
      resolve,
      () => {},
    ),
  ).rejects.toBeInstanceOf(KeyingVerificationError);
  expect(reads).toEqual(["stale-prefetched-root", undefined]);
});
