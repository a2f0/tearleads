import { expect, test } from "bun:test";
import { parseServerTiming } from "./serverTiming";

test("reads total and db durations in any order alongside other metrics", () => {
  expect(parseServerTiming("total;dur=45.5, db;dur=30")).toEqual({
    totalMs: 45.5,
    databaseMs: 30,
  });
  expect(
    parseServerTiming('cache;desc="hit", DB;DUR="12.25" , total;desc=x;dur=40'),
  ).toEqual({ totalMs: 40, databaseMs: 12.25 });
  expect(parseServerTiming("total;dur=8")).toEqual({
    totalMs: 8,
    databaseMs: null,
  });
});

test("ignores missing, malformed and repeated metrics", () => {
  expect(parseServerTiming(null)).toBeNull();
  expect(parseServerTiming("")).toBeNull();
  expect(parseServerTiming("cache;dur=3")).toBeNull();
  expect(parseServerTiming("total, db;dur")).toBeNull();
  for (const value of ["-1", "abc", "1e3", "Infinity", "NaN", "1.", ""]) {
    expect(parseServerTiming(`total;dur=${value}, db;dur=2`)).toEqual({
      totalMs: null,
      databaseMs: 2,
    });
  }
  expect(parseServerTiming("total;dur=5, total;dur=9, db;dur=1")).toEqual({
    totalMs: 5,
    databaseMs: 1,
  });
  expect(parseServerTiming("total;dur=bad;dur=4")).toBeNull();
});
