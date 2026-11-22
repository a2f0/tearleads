import { expect, test } from "bun:test";
import { checkWindowsFixture } from "./verifyWindowsArtifacts.testUtils";

// Each case builds real tar and ZIP archives and verifies them in a child Bun
// process, like the other process-spawning script tests here. The first child
// on a fresh Windows runner also loads the just-synced Electrobun devkit cold:
// it usually takes about 0.2s, but has taken 1.7s and over 5s on CI.
const SPAWNING_TEST_TIMEOUT_MS = 60_000;

for (const tier of ["staging", "production"]) {
  test(
    `${tier} verifies a real Windows ZIP and compressed updater archive`,
    async () => {
      await checkWindowsFixture(tier);
    },
    SPAWNING_TEST_TIMEOUT_MS,
  );
  for (const [failure, message] of [
    ["payload", "Installer payload must match"],
    ["update-hash", "Expected values to be strictly equal"],
    ["installer-hash", "Expected values to be strictly equal"],
    ["installer-map", "Source maps must not ship"],
    ["update-map", "Source maps must not ship"],
    ["artifact-map", "Source maps must not ship"],
    ["setup", "Missing setup executable"],
    ["api", "false == true"],
    ["cef", "Expected values to be strictly equal"],
    ["index.html", "false == true"],
    ["worker.js", "false == true"],
    ["sqlite3.wasm", "false == true"],
  ]) {
    test(
      `${tier} Windows archive verifier rejects ${failure}`,
      async () => {
        await expect(checkWindowsFixture(tier, failure)).rejects.toThrow(
          message,
        );
      },
      SPAWNING_TEST_TIMEOUT_MS,
    );
  }
}
