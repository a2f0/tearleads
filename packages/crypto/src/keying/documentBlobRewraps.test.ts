import { expect, test } from "bun:test";
import {
  assertDocumentBlobRewrapScope,
  normalizeDocumentBlobRewraps,
} from "./documentBlobRewraps";
import type { DocumentLinkSetManifestState } from "./types";

const state: DocumentLinkSetManifestState = {
  version: 1,
  documentId: "document",
  organizationId: "organization",
  epoch: 2,
  previousManifestHash: "a".repeat(64),
  eventHash: "b".repeat(64),
  linkedContainerIds: ["source", "destination"],
};
function rewrap() {
  return [
    {
      blobId: "blob",
      contentKeyEpoch: 1,
      targets: state.linkedContainerIds.map((containerId) => ({
        bindingId: "binding",
        documentId: "document",
        containerId,
        containerManifestHash: "c".repeat(64),
        containerKeyEpochId: `${containerId}-key`,
        containerKeyEpoch: 1,
        wrappedKey: "encrypted-key",
        wrappingMetadata: { suite: "test" },
      })),
    },
  ];
}

test("signed rewrap targets stay within their document and cover each resulting link", () => {
  expect(() =>
    assertDocumentBlobRewrapScope(
      normalizeDocumentBlobRewraps(rewrap()),
      state,
    ),
  ).not.toThrow();
  const wrongDocument = rewrap();
  for (const entry of wrongDocument)
    for (const target of entry.targets) target.documentId = "other-document";
  expect(() =>
    assertDocumentBlobRewrapScope(
      normalizeDocumentBlobRewraps(wrongDocument),
      state,
    ),
  ).toThrow("signed document scope");
  const wrongContainer = rewrap();
  for (const entry of wrongContainer)
    for (const target of entry.targets) target.containerId = "unlinked";
  expect(() => assertDocumentBlobRewrapScope(wrongContainer, state)).toThrow(
    "signed document scope",
  );
  const missing = rewrap().map((entry) => ({
    ...entry,
    targets: entry.targets.slice(1),
  }));
  expect(() => assertDocumentBlobRewrapScope(missing, state)).toThrow(
    "lacks a linked-container target",
  );
});

test("rewrap bodies reject omissions, duplicate blobs, and duplicate targets", () => {
  expect(() => normalizeDocumentBlobRewraps(undefined)).toThrow();
  expect(() =>
    normalizeDocumentBlobRewraps([...rewrap(), ...rewrap()]),
  ).toThrow("repeats a blob");
  const duplicateTargets = rewrap().map((entry) => ({
    ...entry,
    targets: [...entry.targets, ...entry.targets],
  }));
  expect(() => normalizeDocumentBlobRewraps(duplicateTargets)).toThrow(
    "repeats a target",
  );
  expect(normalizeDocumentBlobRewraps([])).toEqual([]);
});
