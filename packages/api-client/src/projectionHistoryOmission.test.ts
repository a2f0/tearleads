import { expect, test } from "bun:test";
import {
  captureProjectionHistory,
  omitProjectionHistory,
  restoreProjectionHistory,
} from "@tearleads/crypto";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
} from "../test/helpers/apiClientTestFactories";

test("omission removes only the committed occurrences of a shared object", () => {
  const full = createDocumentWriterProjectionResponse();
  const manifest = full.documentManifest;
  full.documentManifestHistory = [manifest];
  const retained = captureProjectionHistory(full);
  full.documentManifestHistory.push(manifest);
  const wire = omitProjectionHistory(
    full,
    retained.map((entry) => entry.prefix),
  );
  expect(wire.documentManifestHistory).toHaveLength(1);
  expect(restoreProjectionHistory(wire, retained)).toBe(true);
  expect(wire.documentManifestHistory).toEqual(full.documentManifestHistory);
});

test("omitting one location never changes an aliased history in another path", () => {
  const full = createDocumentWriterProjectionResponse();
  const container = createContainerWriterProjectionResponse();
  const kek = container.containerKeks[0];
  const manifest = container.path[0];
  if (!kek || !manifest) throw new Error("Expected container fixture");
  kek.containerManifestHistory = [manifest];
  full.authorizingContainerPaths = [
    { ...container, containerId: "first" },
    { ...container, containerId: "second" },
  ];
  const retained = captureProjectionHistory(full).filter((entry) =>
    entry.arrayKey.includes("path:0:"),
  );
  expect(retained).toHaveLength(1);
  const wire = omitProjectionHistory(
    full,
    retained.map((entry) => entry.prefix),
  );
  expect(
    wire.authorizingContainerPaths[0]?.containerKeks[0]
      ?.containerManifestHistory,
  ).toHaveLength(0);
  expect(
    wire.authorizingContainerPaths[1]?.containerKeks[0]
      ?.containerManifestHistory,
  ).toHaveLength(1);
  expect(restoreProjectionHistory(wire, retained)).toBe(true);
  expect(wire).toEqual(full);
});
