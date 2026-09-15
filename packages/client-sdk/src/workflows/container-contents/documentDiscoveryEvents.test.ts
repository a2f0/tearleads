import { expect, test } from "bun:test";
import { hasUndiscoveredDocumentUpdateEvent } from "./documentDiscovery";

test("only current scoped updates rediscover unknown shared documents", () => {
  const hint = {
    type: "document_update_created",
    documentId: "peer-note-document",
  };
  expect(hasUndiscoveredDocumentUpdateEvent([hint], new Set())).toBe(false);
  const scoped = { ...hint, containerIds: ["container-1"] };
  expect(hasUndiscoveredDocumentUpdateEvent([scoped], new Set())).toBe(true);
  expect(
    hasUndiscoveredDocumentUpdateEvent([scoped], new Set([hint.documentId])),
  ).toBe(false);
});
