// First, so an opt-in ML-DSA stand-in replaces signing before anything loads
// @tearleads/crypto. A no-op unless TEARLEADS_TEST_FAST_SIGNATURES=1.
import "@tearleads/crypto/fast-signatures-test-fixtures";
import { afterEach } from "bun:test";
import { resetContainerManifestRegistry } from "@tearleads/test-utils";

// Bun shares one module graph across every test file in a run, so the
// container-mutation response fake's manifest registry would otherwise carry
// one test's manifests into the next and hide a missing fixture registration.
afterEach(() => {
  resetContainerManifestRegistry();
});
