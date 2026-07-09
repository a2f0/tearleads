import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  applyTrackedDocumentSummaryUpdates,
  computeContainerMembershipSignatures,
  hasTrackedContainerMembershipChange,
} from "./documentSummaryUtils";

// Whether the DESTRUCTIVE refresh should fire between two container->summaries
// snapshots — the exact gate useExplorerViewProjectionSync applies. `before: null`
// models the first apply after mount / a view rotation.
function refreshWouldFire(
  before: ReadonlyMap<string, ReadonlyArray<DocumentSummary>> | null,
  after: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>,
): boolean {
  return hasTrackedContainerMembershipChange(
    before === null ? null : computeContainerMembershipSignatures(before),
    computeContainerMembershipSignatures(after),
  );
}

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

// The membership gate backs the sidebar-flicker fixes: the DESTRUCTIVE refresh
// must NOT fire on content-only updates (title/sync-badge deltas fire the explorer
// view on every reconciled tick) NOR when a container key merely appears for the
// first time (the active-container switch that collapsed the sidebar on selecting
// the "You" contact) — only on a genuine change to a container already on screen.
test("no refresh when only summary content changes", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you", { title: "You" })]],
  ]);
  const afterTitleSync = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you", { title: "You (synced)" })]],
  ]);

  expect(refreshWouldFire(before, afterTitleSync)).toBe(false);
});

test("no refresh when documents are reordered", () => {
  const ordered = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a"), createSummary("b")]],
  ]);
  const reordered = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("b"), createSummary("a")]],
  ]);

  expect(refreshWouldFire(ordered, reordered)).toBe(false);
});

test("refresh fires when a document is discovered in an existing container", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you")]],
  ]);
  const afterDiscovery = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you"), createSummary("teammate")]],
  ]);

  expect(refreshWouldFire(before, afterDiscovery)).toBe(true);
});

test("refresh fires when a document moves between existing containers", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", []],
  ]);
  const afterMove = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", []],
    ["c2", [createSummary("a")]],
  ]);

  expect(refreshWouldFire(before, afterMove)).toBe(true);
});

test("no refresh from container map ordering alone", () => {
  const oneOrder = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", [createSummary("b")]],
  ]);
  const otherOrder = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c2", [createSummary("b")]],
    ["c1", [createSummary("a")]],
  ]);

  expect(refreshWouldFire(oneOrder, otherOrder)).toBe(false);
});

// The "You"-contact collapse: a container key materializes for the first time when
// its container becomes active. No document moved, so the destructive refresh must
// NOT fire — otherwise the sidebar blanks and the Trash row bounces.
test("no refresh when a container key appears for the first time", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["personal", [createSummary("note")]],
  ]);
  const afterContactsMaterializes = new Map<
    string,
    ReadonlyArray<DocumentSummary>
  >([
    ["personal", [createSummary("note")]],
    ["contacts", [createSummary("you")]],
  ]);

  expect(refreshWouldFire(before, afterContactsMaterializes)).toBe(false);
});

test("refresh fires when a container drops out", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["personal", [createSummary("note")]],
    ["contacts", [createSummary("you")]],
  ]);
  const afterDrop = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["personal", [createSummary("note")]],
  ]);

  expect(refreshWouldFire(before, afterDrop)).toBe(true);
});

test("first apply after mount / view rotation fires once", () => {
  const initial = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you")]],
  ]);

  expect(refreshWouldFire(null, initial)).toBe(true);
});
