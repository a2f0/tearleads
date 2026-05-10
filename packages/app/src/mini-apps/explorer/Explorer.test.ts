import { expect, test } from "bun:test";
import type { DocumentSummary } from "../../data/documentSummary";
import { buildDocumentsByContainerId } from "./Explorer";

test("buildDocumentsByContainerId uses the document container while document links are not projected yet", () => {
  const documentSummaries: DocumentSummary[] = [
    {
      id: "note-1",
      containerId: "root-container",
      documentId: "document-1",
      title: "Fresh root note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ];

  const documentsByContainerId = buildDocumentsByContainerId(
    documentSummaries,
    new Map([["document-1", []]]),
    new Set(["root-container"]),
  );

  expect(documentsByContainerId.get("root-container")).toEqual([
    {
      containerId: "root-container",
      localId: "note-1",
      title: "Fresh root note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ]);
});

test("buildDocumentsByContainerId prefers projected linked containers when they are available", () => {
  const documentSummaries: DocumentSummary[] = [
    {
      id: "note-1",
      containerId: "root-container",
      documentId: "document-1",
      title: "Linked note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ];

  const documentsByContainerId = buildDocumentsByContainerId(
    documentSummaries,
    new Map([["document-1", ["child-container"]]]),
    new Set(["root-container", "child-container"]),
  );

  expect(documentsByContainerId.get("root-container")).toBeUndefined();
  expect(documentsByContainerId.get("child-container")).toEqual([
    {
      containerId: "child-container",
      localId: "note-1",
      title: "Linked note",
      updatedAt: "2026-04-11T12:00:00.000Z",
    },
  ]);
});
