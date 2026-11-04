import { expect, test } from "bun:test";
import {
  type ExplorerItemColumnId,
  getVisibleExplorerItemColumnIds,
  TOGGLEABLE_COLUMN_IDS,
} from "./explorerItemColumnIds";

test("wide layout shows every column with Sync last before the kebab", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set(),
    }),
  ).toEqual(["name", "type", "created", "modified", "sync", "actions"]);
});

test("wide layout drops hidden columns but keeps order and the Name column", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set(["created"]),
    }),
  ).toEqual(["name", "type", "modified", "sync", "actions"]);

  // Name is structural and never hidden, even if it somehow lands in the set.
  expect(
    getVisibleExplorerItemColumnIds({
      compact: false,
      hiddenColumns: new Set<ExplorerItemColumnId>(["name", "type", "sync"]),
    }),
  ).toEqual(["name", "created", "modified", "actions"]);
});

test("compact layout uses a fixed summary set and ignores hidden preferences", () => {
  expect(
    getVisibleExplorerItemColumnIds({
      compact: true,
      hiddenColumns: new Set(["type", "modified"]),
    }),
  ).toEqual(["summary", "actions"]);
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
