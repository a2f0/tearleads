import { expect, test } from "bun:test";
import {
  AUTO_OPFS_VFS_WARNING,
  isIgnorableAutoOpfsVfsWarning,
} from "../src/sqliteBootstrapWarnings";

test("recognizes benign auto OPFS VFS bootstrap warnings", () => {
  expect(
    isIgnorableAutoOpfsVfsWarning([
      AUTO_OPFS_VFS_WARNING,
      "Cannot install OPFS: Missing SharedArrayBuffer and/or Atomics.",
    ]),
  ).toBe(true);
  expect(
    isIgnorableAutoOpfsVfsWarning([
      AUTO_OPFS_VFS_WARNING,
      new Error(
        "Cannot install OPFS: Missing SharedArrayBuffer and/or Atomics.",
      ),
    ]),
  ).toBe(true);
  expect(
    isIgnorableAutoOpfsVfsWarning([
      `${AUTO_OPFS_VFS_WARNING} Cannot install OPFS: Missing SharedArrayBuffer and/or Atomics.`,
    ]),
  ).toBe(true);
  expect(
    isIgnorableAutoOpfsVfsWarning([
      AUTO_OPFS_VFS_WARNING,
      "The OPFS sqlite3_vfs cannot run in the main thread.",
    ]),
  ).toBe(true);
});

test("keeps non-benign OPFS VFS bootstrap warnings", () => {
  expect(
    isIgnorableAutoOpfsVfsWarning([
      AUTO_OPFS_VFS_WARNING,
      "Cannot install OPFS: sqlite3.wasm failed to load.",
    ]),
  ).toBe(false);
  expect(
    isIgnorableAutoOpfsVfsWarning([
      "Cannot install OPFS: Missing SharedArrayBuffer and/or Atomics.",
    ]),
  ).toBe(false);
});

test("keeps arbitrary warning values without throwing", () => {
  const nullPrototypeValue = Object.create(null);
  const throwingToStringValue = {
    toString() {
      throw new Error("string conversion failed");
    },
  };

  expect(isIgnorableAutoOpfsVfsWarning([nullPrototypeValue])).toBe(false);
  expect(isIgnorableAutoOpfsVfsWarning([throwingToStringValue])).toBe(false);
});
