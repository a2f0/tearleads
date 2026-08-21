import { afterEach, expect, test } from "bun:test";
import {
  DEFAULT_HIDDEN_EXPLORER_COLUMNS,
  loadHiddenExplorerColumns,
  saveHiddenExplorerColumns,
} from "./explorerColumnPreferences";

const STORAGE_KEY = "symcrypt.explorer:hidden-columns";

afterEach(() => {
  globalThis.localStorage.clear();
});

test("hides Date Created and Sync by default when nothing is stored", () => {
  expect([...DEFAULT_HIDDEN_EXPLORER_COLUMNS]).toEqual(["created", "sync"]);
  expect([...loadHiddenExplorerColumns()]).toEqual(["created", "sync"]);
});

test("round-trips a saved hidden-column set (load reads what save wrote)", () => {
  saveHiddenExplorerColumns(new Set(["type", "sync"]));
  expect([...loadHiddenExplorerColumns()].sort()).toEqual(["sync", "type"]);
});

test("an explicit empty set persists instead of falling back to the default", () => {
  saveHiddenExplorerColumns(new Set());
  // A written value wins over the default, so opting every column back on sticks.
  expect([...loadHiddenExplorerColumns()]).toEqual([]);
});

test("drops unknown / non-toggleable column ids when loading", () => {
  globalThis.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(["created", "name", "bogus"]),
  );
  // "name" is structural (never toggleable) and "bogus" is unknown.
  expect([...loadHiddenExplorerColumns()]).toEqual(["created"]);
});

test("falls back to the default for malformed stored JSON", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, "not json");
  expect([...loadHiddenExplorerColumns()]).toEqual(["created", "sync"]);
});

test("falls back to the default for a non-array stored value", () => {
  globalThis.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ created: true }),
  );
  expect([...loadHiddenExplorerColumns()]).toEqual(["created", "sync"]);
});
