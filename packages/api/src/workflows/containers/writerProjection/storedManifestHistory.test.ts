import { beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import * as crypto from "@tearleads/crypto";
import { signedContainerHistory } from "../../../../test/helpers/storedManifestHistory";
import { verifyStoredContainerManifest } from "./storedManifestVerification";

// Signing dominates these tests, so both share one history; each starts from no
// markers, as after a new deployment secret or verifier version.
let history: Awaited<ReturnType<typeof signedContainerHistory>>;
beforeAll(async () => {
  history = await signedContainerHistory(4_098);
}, 300_000);
beforeEach(() => {
  history.markers.clear();
});

test("a long container history verifies in full without any marker", async () => {
  const { bundles, createContext, loadBundle, markers } = history;
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
  const { bundles, createContext, loadBundle } = history;
  const head = bundles[2_049];
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
