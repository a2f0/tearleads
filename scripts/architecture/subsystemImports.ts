import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import * as ts from "typescript";
import { listProductionSourceFiles } from "./checkFactories";
import { registeredSubsystemSourcePaths } from "./subsystems";
import type { Subsystem } from "./subsystemTypes";

// Tests and their fixtures may reach into any subsystem.
export const testSupportFilePattern =
  /\.(test|testFixtures|testUtils)\.[cm]?[tj]sx?$/;
const resolvableSuffixes = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** One import between two production files, as repository-relative paths. */
export interface SubsystemImport {
  from: string;
  to: string;
}

/** Imports that predate a rule: imported file -> importing files. */
export type SubsystemImportBaseline = Readonly<
  Record<string, readonly string[]>
>;

export function matchesPath(filePath: string, path: string): boolean {
  return path.endsWith("/") ? filePath.startsWith(path) : filePath === path;
}

export function ownerOf(
  registry: readonly Subsystem[],
  filePath: string,
): Subsystem | undefined {
  return registry.find((subsystem) =>
    subsystem.paths.some((path) => matchesPath(filePath, path)),
  );
}

function resolveRelativeImport(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const base = normalize(join(dirname(from), specifier.replace(/\.js$/, "")));
  return [base, ...resolvableSuffixes.map((suffix) => `${base}${suffix}`)].find(
    (candidate) => files.has(candidate),
  );
}

/** Production files of the registered packages whose owner `includes` keeps. */
export async function listSubsystemFiles(
  registry: readonly Subsystem[],
  includes: (owner: Subsystem) => boolean,
): Promise<string[]> {
  const fileGroups = await Promise.all(
    registeredSubsystemSourcePaths.map(listProductionSourceFiles),
  );
  return fileGroups.flat().filter((filePath) => {
    const owner = ownerOf(registry, filePath);
    return owner !== undefined && includes(owner);
  });
}

/** Every module specifier in `source`, type-only imports included. */
export function allModuleSpecifiers(source: string): string[] {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName);
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return false;
  }
  if (clause.isTypeOnly) {
    return true;
  }
  const bindings = clause.namedBindings;
  return (
    clause.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  const clause = node.exportClause;
  return (
    node.isTypeOnly ||
    (clause !== undefined &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((element) => element.isTypeOnly))
  );
}

function runtimeSpecifierOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    const typeOnly = ts.isImportDeclaration(node)
      ? isTypeOnlyImport(node)
      : isTypeOnlyExport(node);
    if (typeOnly || specifier === undefined || !ts.isStringLiteral(specifier)) {
      return undefined;
    }
    return specifier.text;
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const [argument] = node.arguments;
    return argument !== undefined && ts.isStringLiteralLike(argument)
      ? argument.text
      : undefined;
  }
  return undefined;
}

/**
 * Module specifiers that survive compilation: value, side-effect, and dynamic
 * imports and `export … from`. `import type`, imports whose named bindings
 * are all `type`, `export type … from`, and `import("…")` types are skipped.
 */
export function runtimeModuleSpecifiers(
  source: string,
  fileName = "source.ts",
): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = runtimeSpecifierOf(node);
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/** Relative imports between production files, read with `specifiersOf`. */
export async function readImports(
  files: readonly string[],
  specifiersOf: (source: string, fileName: string) => readonly string[],
): Promise<SubsystemImport[]> {
  const knownFiles = new Set(files);
  const importers = files.filter(
    (filePath) => !testSupportFilePattern.test(filePath),
  );
  const perFile = await Promise.all(
    importers.map(async (from) => {
      const source = await readFile(from, "utf8");
      return specifiersOf(source, from).flatMap((specifier) => {
        const to = resolveRelativeImport(from, specifier, knownFiles);
        return to === undefined || testSupportFilePattern.test(to)
          ? []
          : [{ from, to }];
      });
    }),
  );
  return perFile.flat();
}
