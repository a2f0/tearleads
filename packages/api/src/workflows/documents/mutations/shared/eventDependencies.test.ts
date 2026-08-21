import { expect, test } from "bun:test";
import type { ContainerManifestRef } from "@symcrypt/validators/request";
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

test("document access dependencies exactly match supplied path leaves", () => {
  expect(() =>
    assertDocumentAccessEventDependenciesMatchRequest(request, {
      dependencyManifestHashes: ["source-hash", "target-hash"],
    }),
  ).not.toThrow();
});

test("document access dependencies reject an extra signed hash", () => {
  expect(() =>
    assertDocumentAccessEventDependenciesMatchRequest(request, {
      dependencyManifestHashes: ["extra-hash", "source-hash", "target-hash"],
    }),
  ).toThrow(
    "Document access event dependency hashes do not match supplied manifests",
  );
});
