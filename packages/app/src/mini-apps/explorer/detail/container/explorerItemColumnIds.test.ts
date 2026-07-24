import { expect, test } from "bun:test";
import {
  type ExplorerItemColumnId,
  getVisibleExplorerItemColumnIds,
  TOGGLEABLE_COLUMN_IDS,
} from "./explorerItemColumnIds";

test("wide layout shows every column with Sync last", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set(),
    }),
  ).toEqual(["name", "type", "created", "modified", "sync"]);
});

test("wide layout drops hidden columns but keeps order and the Name column", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set(["created"]),
    }),
  ).toEqual(["name", "type", "modified", "sync"]);

  // Name is structural and never hidden, even if it somehow lands in the set.
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set<ExplorerItemColumnId>(["name", "type", "sync"]),
    }),
  ).toEqual(["name", "created", "modified"]);
});

test("wide touch layout appends the actions column after the data columns", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set(),
      showActions: true,
    }),
  ).toEqual(["name", "type", "created", "modified", "sync", "actions"]);

  // Hidden data columns still drop out; the kebab stays last.
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set(["created", "sync"]),
      showActions: true,
    }),
  ).toEqual(["name", "type", "modified", "actions"]);
});

test("compact layout uses a fixed summary set and ignores hidden preferences", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: true,
      hiddenColumns: new Set(["type", "modified"]),
    }),
  ).toEqual(["summary"]);
});

test("the folded kebab follows the touch layout, not the fold", () => {
  // A phone folds AND is routed, so it keeps the kebab.
  expect(
    getVisibleExplorerItemColumnIds({
      compact: true,
      hiddenColumns: new Set(),
      showActions: true,
    }),
  ).toEqual(["summary", "actions"]);

  // A narrow desktop pane folds but still has right-click, so the kebab would
  // only eat width where width is scarcest.
  expect(
    getVisibleExplorerItemColumnIds({
      compact: true,
      hiddenColumns: new Set(),
    }),
  ).not.toContain("actions");
});

test("compact layout folds every data column into the summary column", () => {
  const compactColumnIds = getVisibleExplorerItemColumnIds({
    compact: true,
    hiddenColumns: new Set(),
  });

  for (const dataColumnId of ["name", "type", "created", "modified", "sync"]) {
    expect(compactColumnIds).not.toContain(dataColumnId);
  }
});

test("Name is not user-toggleable", () => {
  expect(TOGGLEABLE_COLUMN_IDS).not.toContain("name");
  // The summary column is structural too — it is never persisted or toggled.
  expect(TOGGLEABLE_COLUMN_IDS).not.toContain("summary");
  expect([...TOGGLEABLE_COLUMN_IDS].sort()).toEqual([
    "created",
    "modified",
    "sync",
    "type",
  ]);
});
