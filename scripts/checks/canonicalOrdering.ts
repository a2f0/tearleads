import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

/**
 * Hash-adjacent source roots. Everything sorted under these paths feeds a
 * hash, a Merkle root, a signed encoding, or a stored identity, so the order
 * must be code-unit (`@tearleads/crypto` `compareCanonicalStrings`), never a
 * locale collation: `localeCompare` without a locale and `Intl.Collator`
 * differ between runtimes and would make two honest devices disagree.
 */
export const canonicalOrderingRoots = [
  "packages/crypto/src",
  "packages/client-sdk/src/data",
] as const;

export interface CanonicalOrderingViolation {
  readonly column: number;
  readonly filePath: string;
  readonly line: number;
  readonly text: string;
}

function isTestSource(fileName: string): boolean {
  return (
    /\.test\.[cm]?tsx?$/.test(fileName) ||
    /testFixtures?\.[cm]?tsx?$/i.test(fileName) ||
    /testUtils\.[cm]?tsx?$/i.test(fileName)
  );
}

export function listCanonicalOrderingSources(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort(
    (left, right) => (left.name < right.name ? -1 : 1),
  )) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCanonicalOrderingSources(entryPath));
    } else if (/\.[cm]?tsx?$/.test(entry.name) && !isTestSource(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function isLocaleCompareWithoutLocale(
  node: ts.Node,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "localeCompare" &&
    node.arguments.length < 2
  );
}

function isIntlCollator(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Intl" &&
    node.name.text === "Collator"
  );
}

export function collectCanonicalOrderingViolations(
  filePath: string,
  sourceText: string,
): CanonicalOrderingViolation[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: CanonicalOrderingViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (isLocaleCompareWithoutLocale(node) || isIntlCollator(node)) {
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
  };
  visit(sourceFile);
  return violations;
}

export function scanCanonicalOrdering(
  cwd: string,
  roots: readonly string[] = canonicalOrderingRoots,
): CanonicalOrderingViolation[] {
  return roots.flatMap((root) =>
    listCanonicalOrderingSources(join(cwd, root)).flatMap((filePath) =>
      collectCanonicalOrderingViolations(
        relative(cwd, filePath).replace(/\\/g, "/"),
        readFileSync(filePath, "utf8"),
      ),
    ),
  );
}
