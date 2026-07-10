import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as ts from "typescript";

import {
  productionSourceFilePattern,
  testFilePattern,
} from "../dependencySourceRoots";

type SourceFileLister = (dirPath: string) => Promise<string[]>;

export interface ArchitectureCheckResult {
  failed: boolean;
  output: string;
}

export interface ArchitectureCheck {
  run: () => Promise<ArchitectureCheckResult | undefined>;
}

interface SourceMatch {
  filePath: string;
  line: string;
  lineNumber: number;
}

function formatViolation(
  name: string,
  message: string,
  details: ReadonlyArray<string>,
): string {
  return [
    `error ${name}: ${message}`,
    ...details.map((detail) => `  ${detail}`),
  ].join("\n");
}

export function createListCheck<T>(params: {
  findItems: () => Promise<ReadonlyArray<T>>;
  formatItem: (item: T) => string;
  message: string;
  name: string;
}): ArchitectureCheck {
  return {
    async run() {
      const items = await params.findItems();

      if (items.length === 0) {
        return undefined;
      }

      return {
        failed: true,
        output: formatViolation(
          params.name,
          params.message,
          items.map(params.formatItem),
        ),
      };
    },
  };
}

async function listSourceFiles(
  dirPath: string,
  includeFile: (filePath: string) => boolean,
): Promise<string[]> {
  const entries = (await readdir(dirPath, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return listSourceFiles(entryPath, includeFile);
      }

      return includeFile(entryPath) ? [entryPath] : [];
    }),
  );

  return nestedFiles.flat();
}

export async function listProductionSourceFiles(
  dirPath: string,
): Promise<string[]> {
  return listSourceFiles(
    dirPath,
    (filePath) =>
      productionSourceFilePattern.test(filePath) &&
      !testFilePattern.test(filePath),
  );
}

export async function listTestSourceFiles(dirPath: string): Promise<string[]> {
  return listSourceFiles(dirPath, (filePath) => testFilePattern.test(filePath));
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

export async function listExactSourceFile(filePath: string): Promise<string[]> {
  return [filePath];
}

async function listedSourceFiles(
  entryPoints: ReadonlyArray<string>,
  listFiles: SourceFileLister,
): Promise<string[]> {
  const sourceFiles = (await Promise.all(entryPoints.map(listFiles))).flat();

  return [...new Set(sourceFiles)].sort();
}

async function findSourceTextMatches(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister | undefined;
  pattern: RegExp;
}): Promise<SourceMatch[]> {
  const sourceFiles = await listedSourceFiles(
    params.entryPoints,
    params.listFiles ?? listProductionSourceFiles,
  );
  const fileMatches = await Promise.all(
    sourceFiles.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      const codeOnlyContent = sourceTextWithoutComments(content, filePath);
      const originalLines = content.split("\n");

      return codeOnlyContent
        .split("\n")
        .flatMap((line, index): SourceMatch[] => {
          if (!matchesPattern(params.pattern, line)) {
            return [];
          }

          return [
            {
              filePath,
              line: originalLines[index] ?? line,
              lineNumber: index + 1,
            },
          ];
        });
    }),
  );

  return fileMatches.flat();
}

function sourceLanguageVariant(filePath: string): ts.LanguageVariant {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
}

function maskNonNewlineCharacters(
  characters: string[],
  start: number,
  end: number,
): void {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n" && characters[index] !== "\r") {
      characters[index] = " ";
    }
  }
}

function sourceTextWithoutComments(content: string, filePath: string): string {
  const characters = content.split("");
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    sourceLanguageVariant(filePath),
    content,
  );
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      maskNonNewlineCharacters(
        characters,
        scanner.getTokenPos(),
        scanner.getTextPos(),
      );
    }

    token = scanner.scan();
  }

  return characters.join("");
}

function sourceScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
    return ts.ScriptKind.TSX;
  }
  if (filePath.endsWith(".json")) {
    return ts.ScriptKind.JSON;
  }

  return ts.ScriptKind.TS;
}

function isStringModuleSpecifier(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function moduleSpecifierFromNode(
  node: ts.Node,
): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    isStringModuleSpecifier(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier;
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const [argument] = node.arguments;
    return argument && isStringModuleSpecifier(argument) ? argument : undefined;
  }

  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    isStringModuleSpecifier(node.argument.literal)
  ) {
    return node.argument.literal;
  }

  return undefined;
}

async function findModuleSpecifierMatches(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister | undefined;
  matches: (specifier: string) => boolean;
}): Promise<SourceMatch[]> {
  const sourceFiles = await listedSourceFiles(
    params.entryPoints,
    params.listFiles ?? listProductionSourceFiles,
  );
  const fileMatches = await Promise.all(
    sourceFiles.map((filePath) =>
      findFileModuleSpecifierMatches(filePath, params.matches),
    ),
  );

  return fileMatches.flat();
}

async function findFileModuleSpecifierMatches(
  filePath: string,
  matches: (specifier: string) => boolean,
): Promise<SourceMatch[]> {
  const content = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceScriptKind(filePath),
  );
  const lines = content.split("\n");
  const fileMatches: SourceMatch[] = [];

  function visit(node: ts.Node) {
    const moduleSpecifier = moduleSpecifierFromNode(node);
    if (moduleSpecifier && matches(moduleSpecifier.text)) {
      const location = sourceFile.getLineAndCharacterOfPosition(
        moduleSpecifier.getStart(sourceFile),
      );

      fileMatches.push({
        filePath,
        line: lines[location.line]?.trim() ?? moduleSpecifier.text,
        lineNumber: location.line + 1,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return fileMatches;
}

function sourceMatchDetail(match: SourceMatch): string {
  return `${match.filePath}:${match.lineNumber}: ${match.line.trim()}`;
}

export function createSourceTextCheck(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister;
  message: string;
  name: string;
  pattern: RegExp;
}): ArchitectureCheck {
  return createListCheck({
    findItems: () =>
      findSourceTextMatches({
        entryPoints: params.entryPoints,
        listFiles: params.listFiles,
        pattern: params.pattern,
      }),
    formatItem: sourceMatchDetail,
    message: params.message,
    name: params.name,
  });
}

export function createModuleSpecifierCheck(params: {
  entryPoints: ReadonlyArray<string>;
  listFiles?: SourceFileLister;
  matches: (specifier: string) => boolean;
  message: string;
  name: string;
}): ArchitectureCheck {
  return createListCheck({
    findItems: () =>
      findModuleSpecifierMatches({
        entryPoints: params.entryPoints,
        listFiles: params.listFiles,
        matches: params.matches,
      }),
    formatItem: sourceMatchDetail,
    message: params.message,
    name: params.name,
  });
}
