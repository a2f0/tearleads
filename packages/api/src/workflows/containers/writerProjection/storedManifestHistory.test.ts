import { expect, spyOn, test } from "bun:test";
import * as crypto from "@tearleads/crypto";
import { signedContainerHistory } from "../../../../test/helpers/storedManifestHistory";
import { verifyStoredContainerManifest } from "./storedManifestVerification";

test("a long container history verifies in full without any marker", async () => {
  const { bundles, createContext, loadBundle, markers } =
    await signedContainerHistory(4_098);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history head");
  // No markers at all: a new deployment secret or verifier version.
  const context = createContext();
  const verified = await verifyStoredContainerManifest({
    bundle: head,
    context,
    loadBundle,
  });
  expect(verified.state.epoch).toBe(4_098);
  expect(context.verifiedManifestByHash.size).toBe(4_098);
  // Full verification marks every manifest it accepted.
  expect(markers.size).toBe(4_098);
}, 300_000);

test("a marked history is not walked or re-signed after a restart", async () => {
  const { bundles, createContext, loadBundle } =
    await signedContainerHistory(2_050);
  const head = bundles.at(-1);
  const middle = bundles[1_024];
  if (!head || !middle) throw new Error("Missing history fixture");
  await verifyStoredContainerManifest({
    bundle: middle,
    context: createContext(),
    loadBundle,
  });
  // Only the unmarked tail above the marked middle is verified.
  let tailLoads = 0;
  await verifyStoredContainerManifest({
    bundle: head,
    context: createContext(),
    loadBundle: (hash) => {
      tailLoads += 1;
      return loadBundle(hash);
    },
  });
  expect(tailLoads).toBe(2_049 - 1_024);

  const verify = spyOn(crypto, "verifySignedAccessEvent");
  let loads = 0;
  try {
    const verified = await verifyStoredContainerManifest({
      bundle: head,
      context: createContext(),
      loadBundle: (hash) => {
        loads += 1;
        return loadBundle(hash);
      },
    });
    expect(verified.state.epoch).toBe(2_050);
    expect(loads).toBe(0);
    expect(verify).not.toHaveBeenCalled();
  } finally {
    verify.mockRestore();
  }
}, 300_000);

test("a transaction holding a connection does not wait for a reader needing that connection", async () => {
  const { bundles, createContext, loadBundle } =
    await signedContainerHistory(2);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history head");
  const reading = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const outsideReader = verifyStoredContainerManifest({
    bundle: head,
    context: createContext(),
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
    context: createContext(),
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
