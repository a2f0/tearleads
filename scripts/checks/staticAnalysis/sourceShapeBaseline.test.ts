import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
  baselinePath,
  cleanSource,
  emptyBaseline,
  fixture,
  suppressedSource,
} from "./fixture.testUtils";

const fixtures: ReturnType<typeof fixture>[] = [];
function setup() {
  const repo = fixture();
  fixtures.push(repo);
  return repo;
}
afterEach(() => {
  for (const repo of fixtures.splice(0))
    rmSync(repo.cwd, { recursive: true, force: true });
});

test("unused suppression and star-export permissions must be removed", () => {
  const repo = setup();
  repo.write("source.ts", cleanSource);
  repo.baseline({
    ...emptyBaseline,
    suppressions: { "source.ts": { tsIgnore: 1 } },
    approvedStarExports: { "source.ts": ["./removed"] },
  });
  repo.git("add", ".");
  const result = repo.scan();
  expect(result.code).toBe(1);
  expect(result.output).toContain("tsIgnore allowance is stale");
  expect(result.output).toContain('approved star export "./removed" is stale');
  repo.baseline(emptyBaseline);
  expect(repo.scan().code).toBe(0);
});

test("valid permissions pass and additional suppressions or exports fail", () => {
  const repo = setup();
  repo.write("source.ts", `${suppressedSource}export * from './public';\n`);
  repo.baseline({
    ...emptyBaseline,
    suppressions: { "source.ts": { tsIgnore: 1 } },
    approvedStarExports: { "source.ts": ["./public"] },
  });
  repo.git("add", ".");
  expect(repo.scan().code).toBe(0);
  repo.write(
    "source.ts",
    `${suppressedSource.repeat(2)}export * from './private';\n`,
  );
  const result = repo.scan();
  expect(result.code).toBe(1);
  expect(result.output).toContain("tsIgnore count is 2");
  expect(result.output).toContain("unapproved export *");
});

test.each([
  { ...emptyBaseline, unexpected: true },
  { ...emptyBaseline, suppressions: { "source.ts": { typo: 1 } } },
  { ...emptyBaseline, suppressions: { "source.ts": { tsIgnore: 0 } } },
  { ...emptyBaseline, suppressions: { "source.ts": { tsIgnore: -1 } } },
  { ...emptyBaseline, suppressions: { "source.ts": {} } },
  {
    ...emptyBaseline,
    fileSizes: { "source.ts": { lines: "500", bytes: 100 } },
  },
  {
    ...emptyBaseline,
    fileSizes: { "source.ts": { lines: 501.5, bytes: 100 } },
  },
  {
    ...emptyBaseline,
    fileSizes: { "source.ts": { lines: 501, bytes: 100, typo: 1 } },
  },
  {
    ...emptyBaseline,
    approvedStarExports: { "source.ts": ["./same", "./same"] },
  },
  { ...emptyBaseline, approvedStarExports: { "source.ts": [] } },
  { ...emptyBaseline, suppressions: { "../outside.ts": { tsIgnore: 1 } } },
  { fileSizes: {}, suppressions: {} },
])("malformed baseline is rejected: %j", (baseline) => {
  const repo = setup();
  repo.write("source.ts", cleanSource);
  repo.baseline(baseline);
  repo.git("add", ".");
  expect(repo.scan().code).toBe(1);
});

test("invalid staged baseline cannot be hidden by valid working JSON", () => {
  const repo = setup();
  repo.commit();
  repo.write(baselinePath, "{");
  repo.git("add", baselinePath);
  repo.baseline(emptyBaseline);
  expect(repo.scan("--staged").code).toBe(1);
});

test("untracked and excluded permissions are rejected", () => {
  const repo = setup();
  repo.baseline({
    ...emptyBaseline,
    suppressions: { "missing.ts": { tsIgnore: 1 }, "image.png": { todo: 1 } },
  });
  repo.git("add", ".");
  const result = repo.scan();
  expect(result.code).toBe(1);
  expect(result.output).toContain("no longer tracked");
  expect(result.output).toContain("excluded file");
});

test("size ceilings remain budgets, but unnecessary allowances must go", () => {
  const repo = setup();
  repo.write("source.ts", "\n".repeat(501));
  repo.baseline({
    ...emptyBaseline,
    fileSizes: { "source.ts": { lines: 600, bytes: 1000 } },
  });
  repo.git("add", ".");
  expect(repo.scan().code).toBe(0);
  repo.write("source.ts", "\n".repeat(601));
  expect(repo.scan().code).toBe(1);
  repo.write("source.ts", cleanSource);
  expect(repo.scan().output).toContain("baseline is no longer needed");
});
