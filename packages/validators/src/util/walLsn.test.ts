import { expect, test } from "bun:test";
import { isWalLsnString, parseWalLsn } from "./walLsn";

test("parseWalLsn converts PostgreSQL WAL LSN strings", () => {
  expect(parseWalLsn("0/10")).toBe(16n);
  expect(parseWalLsn("1/0")).toBe(4294967296n);
  expect(isWalLsnString("A/B")).toBe(true);
});

test("parseWalLsn rejects malformed WAL LSN strings", () => {
  expect(isWalLsnString("not-an-lsn")).toBe(false);
  expect(isWalLsnString("0/")).toBe(false);
  expect(isWalLsnString("0/1/2")).toBe(false);

  expect(() => parseWalLsn("not-an-lsn", "commit LSN")).toThrow(
    "commit LSN is invalid",
  );
  expect(() => parseWalLsn("0/")).toThrow("Invalid WAL LSN.");
});
