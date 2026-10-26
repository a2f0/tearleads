import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseReport } from "./artifacts";
import { parseMeasurement } from "./sample";

test("reports are replaced atomically with private file and directory permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "database-probe-report-"));
  try {
    const writer = await databaseReport("staging", "run", directory);
    await writer.save({ status: "running" });
    await writer.save({ status: "complete", samples: [1, 2] });
    expect(JSON.parse(await readFile(writer.path, "utf8"))).toEqual({
      status: "complete",
      samples: [1, 2],
    });
    expect((await stat(writer.path)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(directory)).toEqual(["database-staging-run.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unmatched or incomplete measurements cannot be saved as successful samples", () => {
  expect(() => parseMeasurement({ runId: "other" }, "run")).toThrow("match");
  expect(() =>
    parseMeasurement(
      {
        runId: "run",
        repetitions: 20,
        connectMs: 1,
        beginMs: 1,
        firstQueryMs: 1,
        simpleMs: [],
      },
      "run",
    ),
  ).toThrow("Incomplete");
});
