import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  applyTrackedDocumentSummaryUpdates,
  computeContainerMembershipSignature,
} from "./documentSummaryUtils";

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

// The membership signature backs the bootstrap-flicker fix: it must be stable
// across content-only updates (title/sync-badge deltas fire the explorer view on
// every reconciled tick) and only change on genuine membership changes, so the
// destructive link-projection refresh no longer blanks the sidebar rows each tick.
test("membership signature is unchanged when only summary content changes", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you", { title: "You" })]],
  ]);
  const afterTitleSync = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you", { title: "You (synced)" })]],
  ]);

  expect(computeContainerMembershipSignature(afterTitleSync)).toBe(
    computeContainerMembershipSignature(before),
  );
});

test("membership signature is unchanged when documents are reordered", () => {
  const ordered = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a"), createSummary("b")]],
  ]);
  const reordered = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("b"), createSummary("a")]],
  ]);

  expect(computeContainerMembershipSignature(reordered)).toBe(
    computeContainerMembershipSignature(ordered),
  );
});

test("membership signature changes when a document is discovered", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you")]],
  ]);
  const afterDiscovery = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you"), createSummary("teammate")]],
  ]);

  expect(computeContainerMembershipSignature(afterDiscovery)).not.toBe(
    computeContainerMembershipSignature(before),
  );
});

test("membership signature changes when a document moves between containers", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", []],
  ]);
  const afterMove = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", []],
    ["c2", [createSummary("a")]],
  ]);

  expect(computeContainerMembershipSignature(afterMove)).not.toBe(
    computeContainerMembershipSignature(before),
  );
});

test("membership signature is stable regardless of container map ordering", () => {
  const oneOrder = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", [createSummary("b")]],
  ]);
  const otherOrder = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c2", [createSummary("b")]],
    ["c1", [createSummary("a")]],
  ]);

  expect(computeContainerMembershipSignature(otherOrder)).toBe(
    computeContainerMembershipSignature(oneOrder),
  );
});
