import { expect, test } from "bun:test";
import { formatDurationMs } from "./formatDurationMs";

test("durations switch units without rounding up into the next unit's range", () => {
  expect(formatDurationMs(0.2)).toBe("0 ms");
  expect(formatDurationMs(42.4)).toBe("42 ms");
  expect(formatDurationMs(999.4)).toBe("999 ms");
  expect(formatDurationMs(999.6)).toBe("1.0 s");
  expect(formatDurationMs(12_345)).toBe("12.3 s");
  expect(formatDurationMs(59_940)).toBe("59.9 s");
  expect(formatDurationMs(59_960)).toBe("1.0 min");
  expect(formatDurationMs(125_000)).toBe("2.1 min");
});
