import { expect, test } from "bun:test";
import { parseTlcParallelism } from "./tlcTools";

test("unset and empty PROTOCOL_TLC_PARALLELISM default to two runs", () => {
  expect(parseTlcParallelism(undefined)).toBe(2);
  expect(parseTlcParallelism("")).toBe(2);
});

test("PROTOCOL_TLC_PARALLELISM accepts plain positive integers", () => {
  expect(parseTlcParallelism("1")).toBe(1);
  expect(parseTlcParallelism("12")).toBe(12);
  expect(parseTlcParallelism("007")).toBe(7);
});

// checkProtocolModels.sh reads the same variable and rejects these too, so the
// two checks never disagree about one setting.
test("PROTOCOL_TLC_PARALLELISM rejects what the shell check rejects", () => {
  for (const value of ["0", "two", "-1", "2.0", " 2", "0x2", "1e1", "+2"]) {
    expect(parseTlcParallelism(value)).toBeUndefined();
  }
});
