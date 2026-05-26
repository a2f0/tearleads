import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import * as ts from "typescript";

const packageRoot = "packages";
const baselinePath = "scripts/packageAssertionBaseline.json";
const skippedPackageNames = new Set(["test-utils"]);
const skippedPathParts = new Set(["test", "tests"]);

interface Violation {
  readonly column: number;
  readonly filePath: string;
  readonly fingerprint: string;
  readonly line: number;
  readonly text: string;
}

interface BaselineEntry {
  readonly count: number;
  readonly filePath: string;
  readonly fingerprint: string;
}

interface BaselineFile {
  readonly assertions: readonly BaselineEntry[];
}

async function listPackageSourceRoots(): Promise<string[]> {
  const entries = (await readdir(packageRoot, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );

  return entries
    .filter(
      (entry) => entry.isDirectory() && !skippedPackageNames.has(entry.name),
    )
    .map((entry) => join(packageRoot, entry.name, "src"))
    .filter(existsSync);
}

async function listSourceFiles(sourceRoot: string): Promise<string[]> {
  const dirPath = sourceRoot;
  const entries = (await readdir(dirPath, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dirPath, entry.name);
      const relativePath = relative(sourceRoot, entryPath);
      const pathParts = relativePath.split("/");

      if (pathParts.some((part) => skippedPathParts.has(part))) {
        return [];
      }

      if (entry.isDirectory()) {
        return listSourceFiles(entryPath);
      }

      if (!/\.[cm]?tsx?$/.test(entry.name)) {
        return [];
      }

      if (/\.test\.[cm]?tsx?$/.test(entry.name)) {
        return [];
      }

      if (/testFixtures?\.[cm]?tsx?$/i.test(entry.name)) {
        return [];
      }

      return [entryPath];
    }),
  );

  return files.flat();
}

function isConstAssertion(
  sourceFile: ts.SourceFile,
  node: ts.AsExpression,
): boolean {
  return node.type.getText(sourceFile) === "const";
}

function assertionFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function collectViolations(
  filePath: string,
  sourceText: string,
): readonly Violation[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isAsExpression(node) && !isConstAssertion(sourceFile, node)) {
      const { character, line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      violations.push({
        column: character + 1,
        fingerprint: assertionFingerprint(node.getText(sourceFile)),
        filePath,
        line: line + 1,
        text: node.getText(sourceFile),
      });
    }

    if (ts.isTypeAssertionExpression(node)) {
      const { character, line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      violations.push({
        column: character + 1,
        fingerprint: assertionFingerprint(node.getText(sourceFile)),
        filePath,
        line: line + 1,
        text: node.getText(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function baselineKey(input: {
  readonly filePath: string;
  readonly fingerprint: string;
}): string {
  return `${input.filePath}\0${input.fingerprint}`;
}

function countViolations(
  violations: readonly Violation[],
): Map<string, BaselineEntry> {
  const entriesByKey = new Map<string, BaselineEntry>();

  for (const violation of violations) {
    const filePath = relative(process.cwd(), violation.filePath);
    const key = baselineKey({ filePath, fingerprint: violation.fingerprint });
    const existingEntry = entriesByKey.get(key);
    entriesByKey.set(key, {
      count: (existingEntry?.count ?? 0) + 1,
      filePath,
      fingerprint: violation.fingerprint,
    });
  }

  return entriesByKey;
}

async function readBaseline(): Promise<Map<string, number>> {
  if (!existsSync(baselinePath)) {
    return new Map();
  }

  const baseline = JSON.parse(
    await readFile(baselinePath, "utf8"),
  ) as BaselineFile;
  return new Map(
    baseline.assertions.map((entry) => [baselineKey(entry), entry.count]),
  );
}

async function writeBaseline(violations: readonly Violation[]): Promise<void> {
  const assertions = [...countViolations(violations).values()].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.fingerprint.localeCompare(right.fingerprint),
  );
  const baseline: BaselineFile = { assertions };
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

function findUnbaselinedViolations(input: {
  readonly baseline: ReadonlyMap<string, number>;
  readonly violations: readonly Violation[];
}): Violation[] {
  const seenCounts = new Map<string, number>();
  const unbaselinedViolations: Violation[] = [];

  for (const violation of input.violations) {
    const filePath = relative(process.cwd(), violation.filePath);
    const key = baselineKey({ filePath, fingerprint: violation.fingerprint });
    const seenCount = (seenCounts.get(key) ?? 0) + 1;
    seenCounts.set(key, seenCount);

    if (seenCount > (input.baseline.get(key) ?? 0)) {
      unbaselinedViolations.push(violation);
    }
  }

  return unbaselinedViolations;
}

const sourceRoots = await listPackageSourceRoots();
const sourceFiles = (
  await Promise.all(
    sourceRoots.map((sourceRoot) => listSourceFiles(sourceRoot)),
  )
).flat();
const violations = (
  await Promise.all(
    sourceFiles.map(async (filePath) =>
      collectViolations(filePath, await readFile(filePath, "utf8")),
    ),
  )
).flat();

if (process.argv.includes("--write-baseline")) {
  await writeBaseline(violations);
  process.exit(0);
}

const baseline = await readBaseline();
const unbaselinedViolations = findUnbaselinedViolations({
  baseline,
  violations,
});

if (unbaselinedViolations.length > 0) {
  console.error(
    "error package-no-type-assertions: production package sources must not add TypeScript type assertions.",
  );
  for (const violation of unbaselinedViolations) {
    const relativePath = relative(process.cwd(), violation.filePath);
    console.error(
      `  ${relativePath}:${violation.line}:${violation.column} ${violation.fingerprint} ${violation.text}`,
    );
  }
  process.exit(1);
}
