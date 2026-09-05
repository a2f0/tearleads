import { expect, test } from "bun:test";
import type { ContainerManifestRef } from "@tearleads/validators/request";
import { assertDocumentAccessEventDependenciesMatchRequest } from "./eventDependencies";

function ref(containerId: string, manifestHash: string): ContainerManifestRef {
  return { containerId, manifestHash };
}

const request = {
  targetContainerPathRefs: [
    ref("root", "root-hash"),
    ref("target", "target-hash"),
  ],
  authorizingContainerPathRefs: [
    [ref("root", "root-hash"), ref("source", "source-hash")],
  ],
};

test("document access dependencies exactly match deduplicated full paths", () => {
  expect(() =>
    assertDocumentAccessEventDependenciesMatchRequest(request, {
      dependencyManifestHashes: ["source-hash", "root-hash", "target-hash"],
    }),
  ).not.toThrow();
});

test("document access dependencies reject an extra signed hash", () => {
  expect(() =>
    assertDocumentAccessEventDependenciesMatchRequest(request, {
      dependencyManifestHashes: [
        "extra-hash",
        "root-hash",
        "source-hash",
        "target-hash",
      ],
    }),
  ).toThrow(
    "Document access event dependency hashes do not match supplied manifests",
  );
});

test.each([
  { hashes: ["source-hash", "target-hash"] },
  { hashes: ["root-hash", "root-hash", "source-hash", "target-hash"] },
])("document access dependencies reject missing or repeated ancestors: %j", ({
  hashes,
}) => {
  expect(() =>
    assertDocumentAccessEventDependenciesMatchRequest(request, {
      dependencyManifestHashes: [...hashes],
    }),
  ).toThrow("dependency hashes do not match");
});
