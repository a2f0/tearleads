import { expect, test } from "bun:test";
import { signedContainerHistory } from "../../../../test/helpers/storedManifestHistory";
import { createContainerWriterProjectionContext } from "./context";
import {
  clearStoredContainerManifestVerificationCache,
  verifyStoredContainerManifest,
} from "./storedManifestVerification";

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
  clearStoredContainerManifestVerificationCache();
}, 300_000);
