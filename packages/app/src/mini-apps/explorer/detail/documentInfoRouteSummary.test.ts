import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { getDocumentInfoRouteFallbackSummary } from "./documentInfoRouteSummary";

const orphan: DocumentSummary = {
  containerId: null,
  documentId: "remote-orphan",
  id: "local-orphan",
  title: "Orphan",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

test("document info does not trust a cached null-container summary", () => {
  expect(
    getDocumentInfoRouteFallbackSummary({
      documentSummaries: [orphan],
      localId: orphan.id,
      selectedDocument: undefined,
    }),
  ).toBeNull();
  expect(
    getDocumentInfoRouteFallbackSummary({
      documentSummaries: [],
      localId: orphan.id,
      selectedDocument: orphan,
    }),
  ).toBeNull();
});

test("document info can use a container-scoped cached summary", () => {
  const document = { ...orphan, containerId: "root-container" };

  expect(
    getDocumentInfoRouteFallbackSummary({
      documentSummaries: [document],
      localId: document.id,
      selectedDocument: undefined,
    }),
  ).toBe(document);
});
