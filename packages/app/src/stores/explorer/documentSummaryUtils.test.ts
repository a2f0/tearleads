import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { applyTrackedDocumentSummaryUpdates } from "./documentSummaryUtils";

function createSummary(
  id: string,
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    containerId: "container-1",
    documentId: `${id}-doc`,
    documentKind: "note",
    id,
    title: id,
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

test("updates only documents already in the list (never appends)", () => {
  const current = [createSummary("a"), createSummary("b")];
  const next = applyTrackedDocumentSummaryUpdates(current, [
    createSummary("a", { title: "a-renamed" }),
    createSummary("c", { title: "c-new" }),
  ]);

  expect(next.map((summary) => summary.id)).toEqual(["a", "b"]);
  expect(next.find((summary) => summary.id === "a")?.title).toBe("a-renamed");
});

test("applies the last update per id from a coalesced burst", () => {
  const current = [createSummary("a")];
  const next = applyTrackedDocumentSummaryUpdates(current, [
    createSummary("a", { title: "first" }),
    createSummary("a", { title: "second" }),
  ]);

  expect(next.find((summary) => summary.id === "a")?.title).toBe("second");
});

test("returns the same array reference when nothing changed", () => {
  const current = [createSummary("a", { title: "same" })];
  const next = applyTrackedDocumentSummaryUpdates(current, [
    createSummary("a", { title: "same" }),
  ]);

  expect(next).toBe(current);
});
