import { expect, test } from "bun:test";
import { prefetchBlobRewraps } from "./blobContentKeyRewrapStore";

test("prefetching refuses a repeated blob before reading any row", async () => {
  const rewrap = { blobId: "blob-1", contentKeyEpoch: 1, targets: [] };
  let reads = 0;
  const executor = new Proxy(
    {},
    {
      get: () => {
        reads += 1;
        throw new Error("prefetch read the database");
      },
    },
  );
  await expect(
    Reflect.apply(prefetchBlobRewraps, undefined, [
      [rewrap, { ...rewrap, contentKeyEpoch: 2 }],
      executor,
    ]),
  ).rejects.toThrow("must name each blob once");
  expect(reads).toBe(0);
});
