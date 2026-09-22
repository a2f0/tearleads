import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  listSkillDocuments,
  scanSkillPlaceholders,
  skillRoots,
} from "../skillPlaceholders";

const linter = resolve(import.meta.dir, "../lintSkillPlaceholders.ts");
/** Built rather than written literally, so this source carries no `${...}`. */
const braced = (token: string): string => `${"$"}{${token}}`;
const repoRoot = resolve(import.meta.dir, "../../..");

function fixture(files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "tearleads-skill-placeholders-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), source);
  }
  const lint = () => {
    const result = Bun.spawnSync([process.execPath, linter], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
    };
  };
  return { cwd, lint };
}

test("the repository's skill documents carry no argument placeholders", () => {
  expect(scanSkillPlaceholders(repoRoot)).toEqual([]);
});

test("every skill root still holds documents", () => {
  for (const root of skillRoots) {
    expect(listSkillDocuments(join(repoRoot, root)).length).toBeGreaterThan(0);
  }
});

test("argument placeholders in a skill document fail the check", () => {
  const repo = fixture({
    ".claude/skills/ship/SKILL.md":
      "Run:\n\n```bash\nOID=$(git ls-remote \"$URL\" | awk '{ print $1 }')\n```\n",
    ".codex/skills/ship/SKILL.md": `Body: ${braced("2")} and $ARGUMENTS and ${braced("ARGUMENTS")}\n`,
  });
  try {
    const result = repo.lint();

    expect(result.code).toBe(1);
    expect(result.output).toContain("error skill-placeholders:");
    expect(result.output).toContain(".claude/skills/ship/SKILL.md:4:");
    expect(result.output).toContain(".codex/skills/ship/SKILL.md:1:");
    // Every token shape is reported, not just the first.
    for (const token of [
      "$1",
      braced("2"),
      "$ARGUMENTS",
      braced("ARGUMENTS"),
    ]) {
      expect(result.output).toContain(token);
    }
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("placeholders outside the skill roots are ignored", () => {
  const repo = fixture({
    ".claude/skills/ship/SKILL.md": "Use `cut -f1 | head -n 1` instead.\n",
    ".claude/skills/ship/reference.md": "No tokens here either.\n",
    "scripts/checks/example.sh": "awk '{ print $1 }'\n",
    "docs/developer/example.md": "A doc may mention $1 freely.\n",
  });
  try {
    const result = repo.lint();

    expect(result.code).toBe(0);
    expect(result.output).toBe("");
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});
