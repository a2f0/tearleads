import { afterEach } from "bun:test";
import { resetContainerManifestRegistry } from "@tearleads/test-utils";

// Bun shares one module graph across every test file in a run, so the
// container-mutation response fake's manifest registry would otherwise carry
// one test's manifests into the next and hide a missing fixture registration.
afterEach(() => {
  resetContainerManifestRegistry();
});
