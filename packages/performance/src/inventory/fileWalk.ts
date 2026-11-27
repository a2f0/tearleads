import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ignoredDirectoryNames = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "__mocks__",
]);

const testFilePattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const tsSourcePattern = /\.[cm]?tsx?$/u;
const identifierPattern = /\b[A-Za-z_][A-Za-z0-9_]*\b/gu;
const singleLineCommentPattern = /\/\/[^\n]*/gu;
const blockCommentPattern = /\/\*[\s\S]*?\*\//gu;

export async function walkFiles(
  rootDirectory: string,
  predicate: (absolutePath: string) => boolean,
): Promise<string[]> {
  const collected: string[] = [];
  const info = await stat(rootDirectory).catch(() => null);
  if (!info) return collected;
  if (info.isFile()) {
    if (predicate(rootDirectory)) collected.push(rootDirectory);
    return collected;
  }
  await visitDirectory(rootDirectory, predicate, collected);
  collected.sort();
  return collected;
}

async function visitDirectory(
  directory: string,
  predicate: (absolutePath: string) => boolean,
  collected: string[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) continue;
      await visitDirectory(join(directory, entry.name), predicate, collected);
    } else if (entry.isFile()) {
      const fullPath = join(directory, entry.name);
      if (predicate(fullPath)) collected.push(fullPath);
    }
  }
}

function isProductionTsFile(filePath: string): boolean {
  if (!tsSourcePattern.test(filePath)) return false;
  if (filePath.endsWith(".d.ts")) return false;
  if (testFilePattern.test(filePath)) return false;
  if (filePath.includes("/tests/") || filePath.includes("/__tests__/")) {
    return false;
  }
  return true;
}

export function stripTsComments(source: string): string {
  return source
    .replace(blockCommentPattern, " ")
    .replace(singleLineCommentPattern, " ");
}

export interface ProductionTokenIndex {
  readonly filesScanned: number;
  readonly tokenFiles: ReadonlyMap<string, ReadonlySet<string>>;
}

export async function buildProductionTokenIndex(
  repoRoot: string,
  sourceRoots: readonly string[],
  excludedFiles: ReadonlySet<string> = new Set(),
): Promise<ProductionTokenIndex> {
  const files: string[] = [];
  for (const root of sourceRoots) {
    const found = await walkFiles(root, (file) => {
      if (!isProductionTsFile(file)) return false;
      const rel = relative(repoRoot, file);
      return !excludedFiles.has(rel) && !excludedFiles.has(file);
    });
    files.push(...found);
  }

  const tokenFiles = new Map<string, Set<string>>();
  for (const file of files) {
    const content = stripTsComments(await readFile(file, "utf8"));
    const rel = relative(repoRoot, file);
    const seenInFile = new Set<string>();
    for (const match of content.matchAll(identifierPattern)) {
      seenInFile.add(match[0]);
    }
    for (const token of seenInFile) {
      let set = tokenFiles.get(token);
      if (!set) {
        set = new Set();
        tokenFiles.set(token, set);
      }
      set.add(rel);
    }
  }

  return { filesScanned: files.length, tokenFiles };
}

export function isReferencedOutside(
  index: ProductionTokenIndex,
  tokens: readonly string[],
  ignoredFile?: string,
): boolean {
  for (const token of tokens) {
    const files = index.tokenFiles.get(token);
    if (!files || files.size === 0) continue;
    if (ignoredFile === undefined) return true;
    for (const file of files) {
      if (file !== ignoredFile) return true;
    }
  }
  return false;
}
