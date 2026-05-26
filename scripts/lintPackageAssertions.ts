import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import * as ts from "typescript";

const packageRoot = "packages";
const skippedPackageNames = new Set(["test-utils"]);
const skippedPathParts = new Set(["test", "tests"]);

interface Violation {
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
  readonly text: string;
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function relativePosixPath(from: string, to: string): string {
  return toPosixPath(relative(from, to));
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
      const relativePath = relativePosixPath(sourceRoot, entryPath);
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

function collectViolations(
  filePath: string,
  sourceText: string,
): readonly Violation[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isAsExpression(node) && !isConstAssertion(sourceFile, node)) {
      const { character, line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      violations.push({
        column: character + 1,
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

if (violations.length > 0) {
  console.error(
    "error package-no-type-assertions: production package sources must not contain TypeScript type assertions.",
  );
  for (const violation of violations) {
    const relativePath = relativePosixPath(process.cwd(), violation.filePath);
    console.error(
      `  ${relativePath}:${violation.line}:${violation.column} ${violation.text}`,
    );
  }
  process.exit(1);
}
