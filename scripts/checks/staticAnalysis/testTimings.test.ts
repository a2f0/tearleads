import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  caseDurations,
  collectSamples,
  formatTimings,
  isTestJob,
  medianTable,
  testScriptPaths,
  timedShards,
} from "../../testing/testTimings";

const stamp = "2026-11-26T15:24:43.3078981Z ";

test("case durations add up per file, per task, across interleaved groups", () => {
  const log = [
    "##[group]@tearleads/sqlite-instance:build",
    "cache hit, replaying logs c40ac02f0a3942c0",
    "##[group]src/build.test.ts:",
    "(pass) not a test task [9.00ms]",
    "##[endgroup]",
    "##[group]app:test",
    "cache miss, executing e4e4b3fbe40ff109",
    '$ bun test src --parallel=2 "--shard=1/2"',
    "##[group]src/a.test.tsx:",
    "(pass) first [117.37ms]",
    "##[endgroup]",
    "##[group]src/b.test.tsx:",
    "\u001b[0m\u001b[32m(pass)\u001b[0m second [2.00ms]",
    "(fail) broken [3.50ms]",
    "(skip) skipped",
    "##[endgroup]",
    "(pass) outside any file [1000.00ms]",
    "##[group]src/a.test.tsx:",
    "(pass) third [20.00ms]",
    "##[endgroup]",
    "##[group]src/empty.test.tsx:",
    "##[endgroup]",
    "##[group]@tearleads/cli:test",
    "cache bypass, force executing 4d11b139a0b355cb",
    "##[group]src/seed.e2e.test.ts:",
    "(pass) seed uploads the pinned dataset [150752.25ms]",
    "##[endgroup]",
  ]
    .map((line) => stamp + line)
    .join("\n");
  const tasks = caseDurations(log);
  expect(tasks.map(({ name, hash }) => [name, hash])).toEqual([
    ["app", "e4e4b3fbe40ff109"],
    ["@tearleads/cli", "4d11b139a0b355cb"],
  ]);
  expect(Object.fromEntries(tasks[0]?.files ?? [])).toEqual({
    "src/a.test.tsx": 137.37,
    "src/b.test.tsx": 5.5,
    "src/empty.test.tsx": 0,
  });
  expect(Object.fromEntries(tasks[1]?.files ?? [])).toEqual({
    "src/seed.e2e.test.ts": 150752.25,
  });
});

test("test jobs and script paths are read as CI and package scripts name them", () => {
  for (const name of [
    "Build and test",
    "Test (app 1/3)",
    "checks / Test (cli 5/5)",
    "checks / Build and test",
  ])
    expect(isTestJob(name), name).toBe(true);
  for (const name of ["Lint", "Web E2E", "checks / Lint", "Test results"])
    expect(isTestJob(name), name).toBe(false);
  expect(
    testScriptPaths(
      "API_DATABASE=memory bun test src --parallel=2 --timings=test-timings.json",
    ),
  ).toEqual(["src"]);
  expect(
    testScriptPaths("bun test src scripts --no-isolate --pass-with-no-tests"),
  ).toEqual(["src", "scripts"]);
  expect(() => testScriptPaths("vitest run --timings=t.json")).toThrow(
    "Expected a bun test script",
  );
});

test("a replayed task counts once and other packages are left out", () => {
  const task = (name: string, hash: string, ms: number) => ({
    name,
    hash,
    files: new Map([["src/a.test.ts", ms]]),
  });
  const samples = collectSamples(
    [
      task("app", "aaaaaaaaaaaaaaaa", 10),
      task("app", "aaaaaaaaaaaaaaaa", 10),
      task("app", "bbbbbbbbbbbbbbbb", 30),
      task("app", "", 99),
      task("website", "cccccccccccccccc", 5),
    ],
    new Set(["app"]),
  );
  expect([...samples.keys()]).toEqual(["app"]);
  expect(samples.get("app")?.get("src/a.test.ts")).toEqual([10, 30]);
});

test("a table keeps each file's median in the order Bun writes", () => {
  const table = medianTable(
    new Map([
      ["src/b.test.ts", [10, 30, 20]],
      ["src/a.test.ts", [5, 15]],
      ["src/c.test.ts", [10.4]],
      ["src/none.test.ts", []],
    ]),
  );
  expect(formatTimings(table)).toBe(
    `${JSON.stringify(
      {
        version: 1,
        files: {
          "src/b.test.ts": 20,
          "src/a.test.ts": 10,
          "src/c.test.ts": 10,
        },
      },
      null,
      2,
    )}\n`,
  );
});

// Runs the real `bun test --shard --timings` over a fixture, so a Bun upgrade
// that changes the cut fails here before it reaches CI.
test("Bun runs every file in exactly one timed shard, as timedShards predicts", () => {
  const root = mkdtempSync(join(tmpdir(), "tearleads-test-timings-"));
  try {
    const files = [
      "src/a.test.ts",
      "src/b.e2e.test.ts",
      "src/c.test.ts",
      "src/d.test.ts",
      "src/nested/e.test.ts",
      "src/nested/f.test.ts",
      "src/new.test.ts",
      "src/z.test.ts",
    ];
    for (const path of files) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(
        join(root, path),
        `import { test } from "bun:test";\ntest("ran", () => console.log("RAN ${path}"));\n`,
      );
    }
    writeFileSync(join(root, "package.json"), "{}\n");
    // `src/new.test.ts` is missing, as a newly added file is; `src/gone.test.ts`
    // no longer exists.
    const table = {
      "src/a.test.ts": 900,
      "src/b.e2e.test.ts": 4000,
      "src/c.test.ts": 10,
      "src/d.test.ts": 2500,
      "src/nested/e.test.ts": 700,
      "src/nested/f.test.ts": 1200,
      "src/z.test.ts": 300,
      "src/gone.test.ts": 5000,
    };
    writeFileSync(join(root, "timings.json"), formatTimings(table));
    for (const count of [1, 2, 3, 4, 8]) {
      const shards = timedShards(table, files, count);
      const predicted = shards.map(({ files: shard }) => shard);
      const ran = predicted.map((_, index) => {
        const result = Bun.spawnSync(
          [
            process.execPath,
            "test",
            "src",
            "--timings=timings.json",
            `--shard=${index + 1}/${count}`,
          ],
          { cwd: root, stdout: "pipe", stderr: "pipe" },
        );
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        return [...result.stdout.toString().matchAll(/^RAN (\S+)$/gm)]
          .map(([, path]) => path)
          .toSorted();
      });
      expect(ran, `${count} shards`).toEqual(predicted);
      expect(ran.flat().toSorted(), `${count} shards`).toEqual(files);
      // The untimed file costs the table's median (the upper one of eight
      // entries, stale ones included): 1200 ms.
      expect(shards.reduce((sum, { cost }) => sum + cost, 0)).toBe(
        900 + 4000 + 10 + 2500 + 700 + 1200 + 1200 + 300,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // Eighteen short `bun test` processes; a loaded runner needs more than the
  // default 5 s.
}, 60_000);
