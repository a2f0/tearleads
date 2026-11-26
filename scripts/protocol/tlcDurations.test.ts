import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NEGATIVE_CONTROLS } from "./protocolNegativeControls";
import {
  CONTROL_DURATIONS_PATH,
  durationsFromCheckOutput,
  formatTlcDurations,
  longestFirst,
  MODEL_DURATIONS_PATH,
  parseTlcDurations,
} from "./tlcDurations";

const repoRoot = join(import.meta.dir, "../..");

test("starts the longest recorded run first and an unrecorded one before it", () => {
  const durations = new Map([
    ["short", 1],
    ["long", 30],
    ["tied-a", 5],
    ["tied-b", 5],
  ]);
  expect(
    longestFirst(
      ["short", "tied-a", "new", "long", "tied-b", "newer"],
      durations,
      (key) => key,
    ),
  ).toEqual(["new", "newer", "long", "tied-a", "tied-b", "short"]);
  expect(longestFirst(["b", "a"], new Map(), (key) => key)).toEqual(["b", "a"]);
});

test("parses and formats duration files, longest first", () => {
  const text = formatTlcDurations(
    ["header"],
    new Map([
      ["b", 2],
      ["c", 9],
      ["a", 2],
    ]),
  );
  expect(text).toBe("# header\n9 c\n2 a\n2 b\n");
  expect(parseTlcDurations(text, "durations.txt")).toEqual(
    new Map([
      ["c", 9],
      ["a", 2],
      ["b", 2],
    ]),
  );
  for (const [line, error] of [
    ["thirty key", "durations.txt:2 must read"],
    ["30", "durations.txt:2 must read"],
    ["30 key extra", "durations.txt:2 must read"],
    ["-1 key", "durations.txt:2 must read"],
    ["9 c", "durations.txt:2 repeats c"],
  ]) {
    expect(() => parseTlcDurations(`9 c\n${line}\n`, "durations.txt")).toThrow(
      error,
    );
  }
});

test("reads model and control durations from check output and CI logs", () => {
  const output = [
    "2026-11-26T14:25:49.6895923Z Checking formal/a/A.tla with formal/a/A.cfg...",
    "2026-11-26T14:25:49.6897324Z Progress(7) at 2026-11-26 14:09:49: 847,727 states generated",
    "2026-11-26T14:25:49.6898462Z Model checking completed. No error has been found.",
    "2026-11-26T14:25:49.6901532Z Finished in 18s at (2026-11-26 14:10:05)",
    "Checking formal/b/B.tla with formal/b/Long.cfg...",
    "Finished in 03min 11s at (2026-11-26 14:13:03)",
    "Checking formal/b/B.tla with formal/b/Longer.cfg...",
    "Finished in 01h 02min 03s at (2026-11-26 15:13:03)",
    // A failed model replays its log without a summary; it records nothing.
    "Checking formal/c/C.tla with formal/c/C.cfg...",
    "Error: Invariant Safe is violated.",
    "lost-ack: TLC reported invariant Safe violated, as expected (2.4s).",
    "2026-11-26T14:20:13.0888855Z slow-control: TLC reported liveness Live violated, as expected (125.6s).",
    "Checked 3 protocol model configuration(s).",
  ].join("\n");
  expect(durationsFromCheckOutput(output)).toEqual({
    models: new Map([
      ["formal/a/A.tla|formal/a/A.cfg", 18],
      ["formal/b/B.tla|formal/b/Long.cfg", 191],
      ["formal/b/B.tla|formal/b/Longer.cfg", 3723],
    ]),
    controls: new Map([
      ["lost-ack", 2],
      ["slow-control", 126],
    ]),
  });
});

// The checks also refuse a stale entry; this keeps the committed files tidy
// before a check runs.
test("the recorded durations name only registered runs", () => {
  const registry = readFileSync(
    join(repoRoot, "formal/protocol-models.txt"),
    "utf8",
  ).split("\n");
  const models = parseTlcDurations(
    readFileSync(join(repoRoot, MODEL_DURATIONS_PATH), "utf8"),
    MODEL_DURATIONS_PATH,
  );
  for (const pair of models.keys()) {
    expect(registry).toContain(pair);
  }
  const ids = new Set(NEGATIVE_CONTROLS.map(({ id }) => id));
  const controls = parseTlcDurations(
    readFileSync(join(repoRoot, CONTROL_DURATIONS_PATH), "utf8"),
    CONTROL_DURATIONS_PATH,
  );
  for (const id of controls.keys()) {
    expect(ids.has(id), id).toBe(true);
  }
});
