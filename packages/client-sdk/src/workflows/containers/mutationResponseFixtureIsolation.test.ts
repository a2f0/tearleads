import { expect, test } from "bun:test";
import {
  hasRegisteredContainerManifest,
  registerContainerManifestBundles,
} from "@tearleads/test-utils";

const MANIFEST_HASH = "a".repeat(64);

// The container-mutation response fake resolves cited manifests from a
// registry Bun shares across the whole run; the test preload resets it after
// each test, so a manifest one test registered never satisfies another's.
test("a test registers a cited manifest", () => {
  registerContainerManifestBundles([
    {
      event: { body: {}, event: {}, eventHash: "b".repeat(64) },
      manifest: {},
      manifestHash: MANIFEST_HASH,
      state: { containerId: "container-1" },
    },
  ]);
  expect(hasRegisteredContainerManifest(MANIFEST_HASH)).toBe(true);
});

test("a later test starts without that manifest", () => {
  expect(hasRegisteredContainerManifest(MANIFEST_HASH)).toBe(false);
});
