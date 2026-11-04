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

test("size allowances ratchet to the exact size, and unnecessary ones must go", () => {
  const repo = setup();
  repo.write("source.ts", "\n".repeat(601));
  repo.baseline({
    ...emptyBaseline,
    fileSizes: { "source.ts": { lines: 601, bytes: 601 } },
  });
  repo.git("add", ".");
  expect(repo.scan().code).toBe(0);
  repo.write("source.ts", "\n".repeat(602));
  expect(repo.scan().output).toContain("baseline allows 601 lines/601 bytes");
  repo.write("source.ts", "\n".repeat(600));
  expect(repo.scan()).toMatchObject({
    code: 1,
    output: expect.stringContaining("lower it to the current size"),
  });
  repo.write("source.ts", cleanSource);
  expect(repo.scan().output).toContain("baseline is no longer needed");
});

test("Markdown gets a larger byte budget under the same line limit", () => {
  const repo = setup();
  const line = `${"x".repeat(99)}\n`;
  repo.write("guide.md", line.repeat(300));
  repo.write("source.ts", `//${line}`.repeat(250));
  repo.git("add", ".");
  const result = repo.scan();
  expect(result.output).not.toContain("guide.md");
  expect(result.output).toContain(
    "source.ts: file size is 250 lines/25500 bytes but default budget allows 500 lines/20000 bytes",
  );
  repo.write("guide.md", line.repeat(401));
  expect(repo.scan().output).toContain(
    "guide.md: file size is 401 lines/40100 bytes but default budget allows 500 lines/40000 bytes",
  );
});

test("generated files and agent-tool managed skills are excluded", () => {
  const repo = setup();
  const oversized = "\n".repeat(501);
  const skill = ".claude/skills/managed/SKILL.md";
  repo.write("docs/openapi.json", oversized);
  repo.write(skill, `${oversized}${suppressedSource}`);
  repo.write(".claude/skills/local/SKILL.md", oversized);
  repo.write(
    ".agent-tool-skills.json",
    JSON.stringify({ schemaVersion: 1, files: { [skill]: "hash" } }),
  );
  repo.git("add", ".");
  const result = repo.scan();
  expect(result.output).not.toContain("openapi.json");
  expect(result.output).not.toContain(skill);
  expect(result.output).toContain(".claude/skills/local/SKILL.md");
  repo.commit();
  repo.write(skill, `${oversized}${oversized}`);
  repo.git("add", skill);
  expect(repo.scan("--staged").code).toBe(0);
  const exempt = repo.commit();
  repo.write(".agent-tool-skills.json", JSON.stringify({ files: {} }));
  repo.git("add", ".agent-tool-skills.json");
  expect(repo.scan("--staged").output).toContain(skill);
  repo.commit();
  expect(repo.scan("--range", `${exempt}..HEAD`).output).toContain(skill);
});
