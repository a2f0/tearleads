import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import * as ts from "typescript";

const cryptoSourceRoot = "packages/crypto/src";
const skippedRelativePaths = new Set(["keying/testFixtures.ts"]);

interface Violation {
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
  readonly text: string;
}

async function listSourceFiles(dirPath: string): Promise<string[]> {
  const entries = (await readdir(dirPath, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listSourceFiles(entryPath);
      }

      if (!/\.[cm]?tsx?$/.test(entry.name)) {
        return [];
      }

      const relativePath = relative(cryptoSourceRoot, entryPath);
      if (/\.test\.[cm]?tsx?$/.test(entry.name)) {
        return [];
      }

      if (skippedRelativePaths.has(relativePath)) {
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

const sourceFiles = await listSourceFiles(cryptoSourceRoot);
const violations = (
  await Promise.all(
    sourceFiles.map(async (filePath) =>
      collectViolations(filePath, await readFile(filePath, "utf8")),
    ),
  )
).flat();

if (violations.length > 0) {
  console.error(
    "error crypto-no-type-assertions: production crypto sources must not use TypeScript type assertions.",
  );
  for (const violation of violations) {
    const relativePath = relative(process.cwd(), violation.filePath);
    console.error(
      `  ${relativePath}:${violation.line}:${violation.column} ${violation.text}`,
    );
  }
  process.exit(1);
}
