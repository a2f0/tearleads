import { afterEach, expect, test } from "bun:test";
import { signedContainerHistory } from "../../../../test/helpers/storedManifestHistory";
import { createContainerWriterProjectionContext } from "./context";
import {
  clearStoredContainerManifestVerificationCache,
  verifyStoredContainerManifest,
} from "./storedManifestVerification";

afterEach(clearStoredContainerManifestVerificationCache);

test("an accepted long container history remains verifiable after a restart", async () => {
  const { bundles, executor, loadBundle } = await signedContainerHistory(4_098);
  for (const bundle of bundles) {
    // Independent requests can share the process LRU, just like normal writes.
    const verified = await verifyStoredContainerManifest({
      bundle,
      context: createContainerWriterProjectionContext(executor),
      loadBundle,
    });
    expect(verified.manifestHash).toBe(bundle.manifestHash);
  }
  clearStoredContainerManifestVerificationCache();
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history head");
  const context = createContainerWriterProjectionContext(executor);
  const verified = await verifyStoredContainerManifest({
    bundle: head,
    context,
    loadBundle,
  });
  expect(verified.state.epoch).toBe(4_098);
  expect(context.verifiedManifestByHash.size).toBe(4_098);

  const middle = bundles[2_048];
  if (!middle) throw new Error("Missing alternate history head");
  await verifyStoredContainerManifest({
    bundle: middle,
    context: createContainerWriterProjectionContext(executor),
    loadBundle,
  });
  let repeatedLoads = 0;
  await verifyStoredContainerManifest({
    bundle: head,
    context: createContainerWriterProjectionContext(executor),
    loadBundle: (hash) => {
      repeatedLoads += 1;
      return loadBundle(hash);
    },
  });
  expect(repeatedLoads).toBe(0);
}, 300_000);

test("concurrent cold readers share verification of the same signed history", async () => {
  const { bundles, executor, loadBundle } = await signedContainerHistory(4);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history head");
  let loads = 0;
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      verifyStoredContainerManifest({
        bundle: head,
        context: createContainerWriterProjectionContext(executor),
        loadBundle: (hash) => {
          loads += 1;
          return loadBundle(hash);
        },
      }),
    ),
  );
  expect(results.map((value) => value.manifestHash)).toEqual([
    head.manifestHash,
    head.manifestHash,
    head.manifestHash,
  ]);
  expect(loads).toBe(3);
});
