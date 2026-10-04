import { expect, test } from "bun:test";
import {
  captureProjectionHistory,
  omitProjectionHistory,
  restoreProjectionHistory,
} from "@tearleads/crypto";
import { createDocumentWriterProjectionResponse } from "../test/helpers/apiClientTestFactories";

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
