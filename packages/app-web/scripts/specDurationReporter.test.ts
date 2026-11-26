import { expect, test } from "bun:test";
import { formatSpecDurations } from "./specDurationReporter";

test("lists spec files slowest first with their summed time and test count", () => {
  expect(
    formatSpecDurations([
      { project: "chromium", file: "app.spec.ts", durationMs: 4_250, tests: 3 },
      {
        project: "webkit",
        file: "settings-preview.spec.ts",
        durationMs: 61_040,
        tests: 1,
      },
    ]),
  ).toEqual([
    "   61.0s  webkit    settings-preview.spec.ts (1 test)",
    "    4.3s  chromium  app.spec.ts (3 tests)",
  ]);
});
