import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  applyTrackedDocumentSummaryUpdates,
  computeContainerMembershipSignatures,
  diffChangedContainerIds,
} from "./documentSummaryUtils";

// The changed container ids between two summary maps — the exact input the link
// projection uses to decide which sidebar containers to destructively refresh.
function changedContainers(
  before: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>,
  after: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>,
): string[] {
  return diffChangedContainerIds(
    computeContainerMembershipSignatures(before),
    computeContainerMembershipSignatures(after),
  ).sort();
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

// The membership signatures back the flicker fixes: a container's signature must
// be stable across content-only updates (title/sync-badge deltas fire the explorer
// view on every reconciled tick) and change only on genuine membership changes, so
// the destructive link-projection refresh no longer blanks the sidebar rows each
// tick — and reports WHICH container changed so it never blanks another org's rows.
test("no container is reported changed when only summary content changes", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you", { title: "You" })]],
  ]);
  const afterTitleSync = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you", { title: "You (synced)" })]],
  ]);

  expect(changedContainers(before, afterTitleSync)).toEqual([]);
});

test("no container is reported changed when documents are reordered", () => {
  const ordered = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a"), createSummary("b")]],
  ]);
  const reordered = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("b"), createSummary("a")]],
  ]);

  expect(changedContainers(ordered, reordered)).toEqual([]);
});

test("only the discovering container is reported changed", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you")]],
    ["other", [createSummary("elsewhere")]],
  ]);
  const afterDiscovery = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["contacts", [createSummary("you"), createSummary("teammate")]],
    ["other", [createSummary("elsewhere")]],
  ]);

  // "other" (a different org's container) must NOT be reported — that is what
  // keeps its sidebar rows from blanking when "contacts" gains a document.
  expect(changedContainers(before, afterDiscovery)).toEqual(["contacts"]);
});

test("a move reports both the source and target containers", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", []],
  ]);
  const afterMove = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", []],
    ["c2", [createSummary("a")]],
  ]);

  expect(changedContainers(before, afterMove)).toEqual(["c1", "c2"]);
});

// The "You"-contact collapse: the SDK projection cache materializes a container
// lazily the first time it becomes active. That additive key is NOT a membership
// change (no document moved; the doc was already shown from the SQL window query),
// so it must not be reported — otherwise its rows blank and the sidebar collapses.
test("a container appearing for the first time is not reported", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
  ]);
  const afterAdd = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", [createSummary("b")]],
  ]);

  expect(changedContainers(before, afterAdd)).toEqual([]);
});

test("a container that disappears is reported changed", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", [createSummary("b")]],
  ]);
  const afterDrop = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
  ]);

  expect(changedContainers(before, afterDrop)).toEqual(["c2"]);
});

// The mirror of the additive-key skip: an EMPTY container dropping out has no rows
// to blank, so it must not fire a destructive refresh. Only a container that held
// documents needs its rows cleared when it vanishes.
test("an empty container dropping out is not reported", () => {
  const before = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", []],
  ]);
  const afterDrop = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
  ]);

  expect(changedContainers(before, afterDrop)).toEqual([]);
});

// previous === null marks the first apply (mount / view rotation): every present
// container is reported so the initial population runs once.
test("the first apply reports every present container", () => {
  const initial = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", [createSummary("b")]],
  ]);

  expect(
    diffChangedContainerIds(
      null,
      computeContainerMembershipSignatures(initial),
    ).sort(),
  ).toEqual(["c1", "c2"]);
});

test("container map ordering does not affect the reported changes", () => {
  const oneOrder = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c1", [createSummary("a")]],
    ["c2", [createSummary("b")]],
  ]);
  const otherOrder = new Map<string, ReadonlyArray<DocumentSummary>>([
    ["c2", [createSummary("b")]],
    ["c1", [createSummary("a")]],
  ]);

  expect(changedContainers(oneOrder, otherOrder)).toEqual([]);
});
