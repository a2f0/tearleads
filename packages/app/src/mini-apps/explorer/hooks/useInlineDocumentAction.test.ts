import { afterEach, expect, test } from "bun:test";
import type { DocumentSummary, StoredDocumentKind } from "@symcrypt/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import { useInlineDocumentAction } from "./useInlineDocumentAction";

afterEach(cleanup);

function renderOpenInlineDocument(
  onCreateDocument: (localId: string, kind: StoredDocumentKind) => void,
) {
  const mergedDocuments: DocumentSummary[] = [];
  const selectedIds: Array<string | null> = [];
  const expandedIds: string[] = [];
  const { result } = renderHook(() =>
    useInlineDocumentAction({
      expandNode: (nodeId) => expandedIds.push(nodeId),
      mergeDocumentSummary: (summary) => mergedDocuments.push(summary),
      onCreateDocument,
      setSelectedId: (id) => selectedIds.push(id),
    }),
  );
  return { expandedIds, mergedDocuments, openInlineDocument: result.current };
}

test("inline document action reports new documents", () => {
  const createdDocuments: Array<[string, StoredDocumentKind]> = [];
  const { expandedIds, mergedDocuments, openInlineDocument } =
    renderOpenInlineDocument((localId, kind) => {
      createdDocuments.push([localId, kind]);
    });

  openInlineDocument("container-1", "contact");

  expect(mergedDocuments).toHaveLength(1);
  expect(createdDocuments).toHaveLength(1);
  expect(createdDocuments[0]?.[0]).toBe(mergedDocuments[0]?.id);
  expect(createdDocuments[0]?.[1]).toBe("contact");
  expect(expandedIds).toEqual(["container-1"]);
});

test("inline document action does not report existing documents", () => {
  const createdDocuments: Array<[string, StoredDocumentKind]> = [];
  const { mergedDocuments, openInlineDocument } = renderOpenInlineDocument(
    (localId, kind) => {
      createdDocuments.push([localId, kind]);
    },
  );

  openInlineDocument("container-1", "contact", "existing-contact");

  expect(mergedDocuments).toEqual([]);
  expect(createdDocuments).toEqual([]);
});
