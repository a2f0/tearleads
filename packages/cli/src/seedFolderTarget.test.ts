import { expect, test } from "bun:test";
import { seedFolderId } from "./seedFolderTarget";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const isUuidV4String = (value: string) => UUID_V4.test(value);

test("a seed folder id is stable per key, root, and name, and v4-shaped", () => {
  const key = new Uint8Array(32).fill(7);
  const id = seedFolderId(key, "root", "Family");
  expect(isUuidV4String(id)).toBe(true);
  expect(seedFolderId(key, "root", "Family")).toBe(id);
  for (const other of [
    seedFolderId(new Uint8Array(32).fill(8), "root", "Family"),
    seedFolderId(key, "other-root", "Family"),
    seedFolderId(key, "root", "Friends"),
  ]) {
    expect(isUuidV4String(other)).toBe(true);
    expect(other).not.toBe(id);
  }
});
