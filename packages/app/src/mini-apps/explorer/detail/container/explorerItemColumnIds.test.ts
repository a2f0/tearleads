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

test("compact layout uses a fixed trimmed set and ignores hidden preferences", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: true,
      hiddenColumns: new Set(["type", "modified"]),
    }),
  ).toEqual(["name", "modified", "actions"]);
});

test("compact layout drops the type column (icon conveys kind)", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: true,
      hiddenColumns: new Set(),
    }),
  ).not.toContain("type");
});

test("Name is not user-toggleable", () => {
  expect(TOGGLEABLE_COLUMN_IDS).not.toContain("name");
  expect([...TOGGLEABLE_COLUMN_IDS].sort()).toEqual([
    "created",
    "modified",
    "sync",
    "type",
  ]);
});
