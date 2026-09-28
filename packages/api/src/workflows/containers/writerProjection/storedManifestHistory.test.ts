import { afterEach, expect, spyOn, test } from "bun:test";
import * as crypto from "@tearleads/crypto";
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

test("independent database snapshots share pure signature verification", async () => {
  const { bundles, executor, loadBundle } = await signedContainerHistory(4);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history head");
  const verify = spyOn(crypto, "verifySignedAccessEvent");
  try {
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        verifyStoredContainerManifest({
          bundle: head,
          context: createContainerWriterProjectionContext(
            new Proxy(executor, {}),
          ),
          loadBundle,
        }),
      ),
    );
    expect(results.map((value) => value.manifestHash)).toEqual([
      head.manifestHash,
      head.manifestHash,
      head.manifestHash,
    ]);
    expect(verify).toHaveBeenCalledTimes(4);
  } finally {
    verify.mockRestore();
  }
});

test("a transaction holding a connection does not wait for a reader needing that connection", async () => {
  const { bundles, executor, loadBundle } = await signedContainerHistory(2);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history head");
  const reading = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const outsideReader = verifyStoredContainerManifest({
    bundle: head,
    context: createContainerWriterProjectionContext(executor),
    loadBundle: async (hash) => {
      reading.resolve();
      // Model a pool read queued behind the transaction below. That caller
      // cannot release its connection until its own verification completes.
      await released.promise;
      return loadBundle(hash);
    },
  });
  await reading.promise;
  const transaction = verifyStoredContainerManifest({
    bundle: head,
    context: createContainerWriterProjectionContext(new Proxy(executor, {})),
    loadBundle,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const completed = await Promise.race([
      transaction.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2_000);
      }),
    ]);
    expect(completed).toBe(true);
  } finally {
    clearTimeout(timer);
    released.resolve();
    await Promise.all([outsideReader, transaction]);
  }
});
