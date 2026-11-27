import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEpochCommand } from "./command";
import { epochUsage } from "./options";
import type { EpochManifest } from "./schema";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tearleads-epoch-cmd-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function writeSamplePlans(
  sortQueries: number,
  path: string,
  revision = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  dirty = false,
): Promise<void> {
  return writeFile(
    path,
    JSON.stringify({
      scenario: "postgres-query-plans",
      revision,
      dirty,
      summary: {
        inspected: 25,
        planned: 23,
        skipped: 2,
        seqScanQueries: 0,
        sortQueries,
        plans:
          sortQueries > 0
            ? [
                {
                  sql: "select * from t order by x",
                  count: 100,
                  status: "planned",
                  nodeTypes: ["Sort"],
                  warnings: [{ kind: "Sort" }, { kind: "Materialize" }],
                },
              ]
            : [],
      },
    }),
  );
}

describe("runEpochCommand", () => {
  test("prints usage on --help", async () => {
    const out: string[] = [];
    const code = await runEpochCommand(["--help"], {
      repoRoot: await makeTempDir(),
      resultsDir: await makeTempDir(),
      print: (line) => out.push(line),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toBe(epochUsage);
  });

  test("records, updates in-place, renders, and rejects corrupt manifests", async () => {
    const dir = await makeTempDir();
    const resultsDir = join(dir, "results");
    const plans0 = join(dir, "plans-0.json");
    const plans1 = join(dir, "plans-1.json");
    const plans2 = join(dir, "plans-2.json");
    await Promise.all([
      writeSamplePlans(3, plans0),
      writeSamplePlans(1, plans1),
      writeSamplePlans(0, plans2),
    ]);

    const out: string[] = [];
    const host = {
      repoRoot: dir,
      resultsDir,
      print: (line: string) => out.push(line),
    };
    expect(
      await runEpochCommand(
        [
          "record",
          "--id",
          "000-baseline",
          "--label",
          "Base",
          "--kind",
          "baseline",
          "--plans",
          plans0,
        ],
        host,
      ),
    ).toBe(0);
    expect(
      await runEpochCommand(
        ["record", "--id", "001-mid", "--label", "Mid", "--plans", plans1],
        host,
      ),
    ).toBe(0);
    expect(
      await runEpochCommand(
        ["record", "--id", "002-end", "--label", "End", "--plans", plans2],
        host,
      ),
    ).toBe(0);

    // Re-recording 001-mid compares 000-baseline -> 001-mid, not 001-mid -> 002-end.
    const updateOut: string[] = [];
    expect(
      await runEpochCommand(
        [
          "record",
          "--id",
          "001-mid",
          "--label",
          "Mid updated",
          "--plans",
          plans1,
        ],
        { ...host, print: (line) => updateOut.push(line) },
      ),
    ).toBe(0);
    expect(updateOut.join("\n")).toContain("`000-baseline` -> `001-mid`");

    const renderOut: string[] = [];
    expect(
      await runEpochCommand(["render"], {
        ...host,
        print: (line) => renderOut.push(line),
      }),
    ).toBe(0);
    expect(renderOut.join("\n")).toContain("3 snapshots");

    const manifest = JSON.parse(
      await readFile(join(resultsDir, "epoch-2/manifest.json"), "utf8"),
    ) as EpochManifest;
    expect(manifest.entries.map((e) => e.id)).toEqual([
      "000-baseline",
      "001-mid",
      "002-end",
    ]);

    const corruptDir = join(dir, "corrupt");
    await mkdir(join(corruptDir, "epoch-2"), { recursive: true });
    await writeFile(join(corruptDir, "epoch-2/manifest.json"), "{bad json");
    await expect(
      runEpochCommand(
        ["record", "--id", "000-base", "--label", "Base", "--plans", plans0],
        { ...host, resultsDir: corruptDir },
      ),
    ).rejects.toThrow();
  });

  test("analyzes snapshots in markdown/json and validates snapshot shape and errors", async () => {
    const dir = await makeTempDir();
    const resultsDir = join(dir, "results");
    const plans0 = join(dir, "plans-0.json");
    const plans1 = join(dir, "plans-1.json");
    await Promise.all([
      writeSamplePlans(3, plans0),
      writeSamplePlans(0, plans1),
    ]);

    const host = { repoRoot: dir, resultsDir, print: () => undefined };
    await runEpochCommand(
      [
        "record",
        "--id",
        "000-baseline",
        "--label",
        "Base",
        "--kind",
        "baseline",
        "--plans",
        plans0,
      ],
      host,
    );
    await expect(runEpochCommand(["analyze"], host)).rejects.toThrow(
      /Need at least 2/u,
    );

    await runEpochCommand(
      ["record", "--id", "001-after", "--label", "After", "--plans", plans1],
      host,
    );

    const mdOut: string[] = [];
    expect(
      await runEpochCommand(["analyze"], {
        ...host,
        print: (line) => mdOut.push(line),
      }),
    ).toBe(0);
    expect(mdOut.join("\n")).toContain("`000-baseline` -> `001-after`");

    const jsonOut: string[] = [];
    expect(
      await runEpochCommand(
        ["analyze", "--from", "000-baseline", "--to", "001-after", "--json"],
        { ...host, print: (line) => jsonOut.push(line) },
      ),
    ).toBe(0);
    const parsed = JSON.parse(jsonOut.join("\n"));
    expect(parsed.beforeId).toBe("000-baseline");
    expect(parsed.afterId).toBe("001-after");

    await expect(
      runEpochCommand(["analyze", "--from", "missing"], host),
    ).rejects.toThrow(/Unknown --from/u);
    await expect(
      runEpochCommand(["analyze", "--to", "missing"], host),
    ).rejects.toThrow(/Unknown --to/u);

    // Malformed snapshot throws during loadAllSnapshots validation.
    await writeFile(
      join(resultsDir, "epoch-2/snapshots/001-after.json"),
      JSON.stringify({ schemaVersion: 1, epoch: 2, id: 123 }),
    );
    await expect(runEpochCommand(["render"], host)).rejects.toThrow(
      /not a valid Epoch 2 snapshot/u,
    );

    // Mismatched snapshot ID throws.
    await writeFile(
      join(resultsDir, "epoch-2/snapshots/001-after.json"),
      JSON.stringify({
        schemaVersion: 1,
        epoch: 2,
        id: "wrong-id",
        label: "Wrong",
        kind: "checkpoint",
        recordedAt: "2026-11-27T00:00:00Z",
        revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        dirty: false,
        issues: [],
        runtime: { bun: "1", platform: "darwin", arch: "arm64", cpu: null },
      }),
    );
    await expect(runEpochCommand(["render"], host)).rejects.toThrow(
      /does not match manifest entry/u,
    );

    // Path traversal in manifest snapshotFile throws.
    const manifestPath = join(resultsDir, "epoch-2/manifest.json");
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as EpochManifest;
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        entries: [{ ...manifest.entries[0], snapshotFile: "../escape.json" }],
      }),
    );
    await expect(runEpochCommand(["render"], host)).rejects.toThrow(/escapes/u);

    // Mismatched revisions across input reports throws.
    const plansRevB = join(dir, "plans-b.json");
    const reloadRevA = join(dir, "reload-a.json");
    await writeSamplePlans(
      0,
      plansRevB,
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    await writeFile(
      reloadRevA,
      JSON.stringify({
        scenario: "document-reload",
        status: "complete",
        revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        dirty: false,
        summary: [],
      }),
    );
    await expect(
      runEpochCommand(
        [
          "record",
          "--id",
          "002-mix",
          "--label",
          "Mix",
          "--plans",
          plansRevB,
          "--reload",
          reloadRevA,
        ],
        { ...host, resultsDir: join(dir, "mix") },
      ),
    ).rejects.toThrow(/different revisions/u);
  });
});
