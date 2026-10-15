import { expect, test } from "bun:test";
import { MAX_CONTAINER_MANIFEST_HISTORY_REFS } from "../util/containerLimits";
import { ContainerManifestRefListSchema } from "./containerManifestRef";

function refs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    containerId: "container-1",
    manifestHash: index.toString(16).padStart(64, "0"),
  }));
}

// Each reference costs the server a stored-manifest resolution, and is ~50x
// smaller than the inline bundle it replaced, so the list keeps the capacity
// inline history had under the request-body ceiling rather than growing it.
test("cited manifest history is bounded", () => {
  expect(
    ContainerManifestRefListSchema.safeParse(
      refs(MAX_CONTAINER_MANIFEST_HISTORY_REFS),
    ).success,
  ).toBe(true);
  expect(
    ContainerManifestRefListSchema.safeParse(
      refs(MAX_CONTAINER_MANIFEST_HISTORY_REFS + 1),
    ).success,
  ).toBe(false);
});
