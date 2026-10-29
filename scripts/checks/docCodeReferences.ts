import { posix } from "node:path";
import type { DocLinkIssue, RepositoryFiles } from "./docLinks";
import { linkTextRanges, proseLines } from "./markdownScan";

/**
 * A code span naming a repository path (`packages/crypto/src/x.ts`) in a
 * published document should be a link, so readers on GitHub and the website
 * can open the file. Spans holding globs, braces, or placeholders
 * (`packages/<name>/src`, `{a,b}.ts`) name no single path and are left alone.
 */
/** Published documentation, where code references must be links. */
export const codeReferenceRoots = ["docs/", "formal/"] as const;

export function isCodeReferenceDocument(document: string): boolean {
  return codeReferenceRoots.some((prefix) => document.startsWith(prefix));
}

export interface CodeReference {
  readonly line: number;
  /** Index of the code span's opening backtick on its line. */
  readonly start: number;
  readonly end: number;
  readonly content: string;
  /** The link target, relative to the document. */
  readonly target: string;
}

export function findCodeReferences(
  repo: RepositoryFiles,
  document: string,
  source: string,
): CodeReference[] {
  const references: CodeReference[] = [];
  for (const line of proseLines(source)) {
    // A reference definition's label (`[label]: target`) is not prose.
    if (/^ {0,3}\[[^\]]+\]:/.test(line.masked)) continue;
    const linked = linkTextRanges(line.masked);
    for (const span of line.codeSpans) {
      if (
        linked.some(([open, close]) => open < span.start && span.end <= close)
      ) {
        continue;
      }
      const target = referenceTarget(repo, document, span.content);
      if (target !== null) {
        references.push({
          line: line.number,
          start: span.start,
          end: span.end,
          content: span.content,
          target,
        });
      }
    }
  }
  return references;
}

function referenceTarget(
  repo: RepositoryFiles,
  document: string,
  content: string,
): string | null {
  const match = /^([^\s:#]+?)(\/?)(?::(\d+)(?:-(\d+))?)?$/.exec(content);
  if (match === null) return null;
  const [, path = "", slash, startLine, endLine] = match;
  if (/[*?<>{}[\]$]/.test(path) || !`${path}${slash}`.includes("/")) {
    return null;
  }
  const normalized = posix.normalize(path);
  if (normalized !== path || path.startsWith("../")) return null;
  const isDirectory = repo.directories.has(path);
  if (!isDirectory && !repo.files.has(path)) return null;
  if (isDirectory && startLine !== undefined) return null;
  const relative = posix.relative(posix.dirname(document), path);
  const fragment =
    startLine === undefined
      ? ""
      : `#L${startLine}${endLine === undefined ? "" : `-L${endLine}`}`;
  return `${relative}${isDirectory || slash === "/" ? "/" : ""}${fragment}`;
}

export function codeReferenceIssues(
  repo: RepositoryFiles,
  document: string,
  source: string,
): DocLinkIssue[] {
  return findCodeReferences(repo, document, source).map((reference) => ({
    file: document,
    line: reference.line,
    column: reference.start + 1,
    target: reference.content,
    reason: `unlinked code reference; write [\`${reference.content}\`](${reference.target})`,
  }));
}

/** `source` with every unlinked code reference turned into a link. */
export function linkCodeReferences(
  repo: RepositoryFiles,
  document: string,
  source: string,
): string {
  const lines = source.split("\n");
  const references = findCodeReferences(repo, document, source).sort(
    (left, right) => right.line - left.line || right.start - left.start,
  );
  for (const reference of references) {
    const index = reference.line - 1;
    const text = lines[index] ?? "";
    const span = text.slice(reference.start, reference.end);
    lines[index] =
      `${text.slice(0, reference.start)}[${span}](${reference.target})${text.slice(reference.end)}`;
  }
  return lines.join("\n");
}
