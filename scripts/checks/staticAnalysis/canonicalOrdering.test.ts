import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  canonicalOrderingRoots,
  scanCanonicalOrdering,
} from "../canonicalOrdering";

const linter = resolve(import.meta.dir, "../../lintCanonicalOrdering.ts");
const repoRoot = resolve(import.meta.dir, "../../..");

function fixture(files: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), "tearleads-canonical-ordering-"));
  for (const root of canonicalOrderingRoots) {
    mkdirSync(join(cwd, root), { recursive: true });
  }
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

test("the repository's hash-adjacent roots contain no locale-dependent ordering", () => {
  expect(scanCanonicalOrdering(repoRoot)).toEqual([]);
});

test("locale-dependent sorts in hash-adjacent roots fail, tests and other roots are ignored", () => {
  const repo = fixture({
    "packages/crypto/src/roots.ts":
      "export const sorted = ['b', 'a'].sort((l, r) => l.localeCompare(r));\n",
    "packages/crypto/src/roots.test.ts":
      "export const sorted = ['b', 'a'].sort((l, r) => l.localeCompare(r));\n",
    "packages/crypto/src/keying/testFixtures.ts":
      "export const sorted = ['b', 'a'].sort((l, r) => l.localeCompare(r));\n",
    "packages/client-sdk/src/data/persistence/ids.ts":
      "const collator = new Intl.Collator();\nexport const sorted = ['b', 'a'].sort(collator.compare);\n",
    "packages/client-sdk/src/data/display.ts":
      "export const sorted = ['b', 'a'].sort((l, r) => l.localeCompare(r, 'en'));\n",
    "packages/client-sdk/src/workflows/list.ts":
      "export const sorted = ['b', 'a'].sort((l, r) => l.localeCompare(r));\n",
    "packages/app/src/view.ts":
      "export const sorted = ['b', 'a'].sort((l, r) => l.localeCompare(r));\n",
  });
  try {
    const result = repo.lint();
    expect(result.code).toBe(1);
    expect(result.output).toContain("error canonical-ordering");
    expect(result.output).toContain(
      "packages/crypto/src/roots.ts:1:49 l.localeCompare(r)",
    );
    expect(result.output).toContain(
      "packages/client-sdk/src/data/persistence/ids.ts:1:22 Intl.Collator",
    );
    expect(result.output).not.toContain("roots.test.ts");
    expect(result.output).not.toContain("testFixtures.ts");
    expect(result.output).not.toContain("display.ts");
    expect(result.output).not.toContain("workflows/list.ts");
    expect(result.output).not.toContain("packages/app");
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("code-unit comparisons pass", () => {
  const repo = fixture({
    "packages/crypto/src/order.ts":
      "export const compare = (l: string, r: string) => (l < r ? -1 : l > r ? 1 : 0);\n",
  });
  try {
    const result = repo.lint();
    expect(result.output).toBe("");
    expect(result.code).toBe(0);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});
