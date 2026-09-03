/**
 * Executable check for the formal abstraction maps: every backticked model
 * operator named in a `Model action … | Production …` table under formal/
 * must occur in the TLA+ module that table documents (the nearest `.tla`
 * link above it), and every backticked production seam must occur in
 * production package source — with all segments of a dotted seam like
 * `Type.member` found together in one file. The registry below pins exactly
 * which documents carry maps and how many, so a whole table cannot vanish or
 * change headers without failing. A rename or deletion on either side of a
 * map fails this check instead of silently making the documentation
 * prose-only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const TABLE_HEADER_PATTERN =
  /^\|\s*Model action(?: or predicate)?\s*\|\s*Production (?:implementation|seam)\s*\|$/;
const TLA_LINK_PATTERN = /\(([^()\s]+\.tla)\)/g;

/** Every document that carries abstraction-map tables, with its exact count. */
const EXPECTED_TABLES: Readonly<Record<string, number>> = {
  "formal/README.md": 2,
  "formal/document-sync/BaselineDominance.md": 1,
  "formal/document-sync/RawHistoryRecovery.md": 1,
  "formal/document-sync/RestartProbeConvergence.md": 1,
};

export interface FormalSourceFile {
  readonly content: string;
  readonly path: string;
}

export interface MappedToken {
  readonly doc: string;
  readonly line: number;
  readonly module: string;
  readonly side: "model" | "production";
  readonly token: string;
}

export function extractBacktickedTokens(cell: string): string[] {
  const tokens: string[] = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    const token = match[1] ?? "";
    // The maps name identifiers, wire tags, and dotted member accesses; any
    // other shape means the table format drifted, which should fail loudly
    // rather than pass unchecked.
    if (!/^[A-Za-z0-9_.]+$/.test(token)) {
      throw new Error(`unexpected abstraction-map token shape: \`${token}\``);
    }
    tokens.push(token);
  }
  return tokens;
}

function nearestModuleLink(
  doc: FormalSourceFile,
  lines: readonly string[],
  headerIndex: number,
): string {
  for (let index = headerIndex; index >= 0; index -= 1) {
    const links = [...(lines[index] ?? "").matchAll(TLA_LINK_PATTERN)];
    const lastLink = links.at(-1)?.[1];
    if (lastLink) {
      return join(dirname(doc.path), lastLink);
    }
  }
  throw new Error(
    `${doc.path}:${headerIndex + 1}: no .tla link precedes this abstraction-map table, so its model tokens cannot be bound to a module.`,
  );
}

function rowTokens(
  doc: string,
  module: string,
  line: number,
  cells: string,
): { readonly problems: string[]; readonly tokens: MappedToken[] } {
  const parts = cells.split("|").map((cell) => cell.trim());
  const sides = [
    ["model", parts[1] ?? ""],
    ["production", parts[2] ?? ""],
  ] as const;
  const tokens = sides.flatMap(([side, cell]) =>
    extractBacktickedTokens(cell).map((token) => ({
      doc,
      line,
      module,
      side,
      token,
    })),
  );
  // A production cell with no backticked seam is prose-only documentation:
  // the seam it describes could vanish without any check noticing.
  const problems = tokens.some((token) => token.side === "production")
    ? []
    : [
        `${doc}:${line}: abstraction-map row names no backticked production seam.`,
      ];
  return { problems, tokens };
}

function tableTokens(
  doc: string,
  module: string,
  lines: readonly string[],
  headerIndex: number,
): {
  readonly nextIndex: number;
  readonly problems: string[];
  readonly tokens: MappedToken[];
} {
  const tokens: MappedToken[] = [];
  const problems: string[] = [];
  let row = headerIndex + 2; // skip the |---|---| separator
  for (; row < lines.length; row += 1) {
    const line = (lines[row] ?? "").trim();
    if (!line.startsWith("|")) {
      break;
    }
    const parsed = rowTokens(doc, module, row + 1, line);
    tokens.push(...parsed.tokens);
    problems.push(...parsed.problems);
  }
  if (row === headerIndex + 2) {
    throw new Error(`${doc}: abstraction-map table has no rows.`);
  }
  return { nextIndex: row - 1, problems, tokens };
}

export function collectMappedTokens(docs: readonly FormalSourceFile[]): {
  readonly problems: string[];
  readonly tablesByDoc: ReadonlyMap<string, number>;
  readonly tokens: MappedToken[];
} {
  const tablesByDoc = new Map<string, number>();
  const tokens: MappedToken[] = [];
  const problems: string[] = [];

  for (const doc of docs) {
    const lines = doc.content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!TABLE_HEADER_PATTERN.test((lines[index] ?? "").trim())) {
        continue;
      }
      tablesByDoc.set(doc.path, (tablesByDoc.get(doc.path) ?? 0) + 1);
      const module = nearestModuleLink(doc, lines, index);
      const table = tableTokens(doc.path, module, lines, index);
      tokens.push(...table.tokens);
      problems.push(...table.problems);
      index = table.nextIndex;
    }
  }

  return { problems, tablesByDoc, tokens };
}

function hasWordOccurrence(content: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(content);
}

/**
 * A model token must survive comment stripping and appear as an actual
 * declaration: an operator definition (`Name ==` / `Name(args) ==`) or a name
 * inside a VARIABLES/CONSTANTS list. An operator renamed away cannot pass on a
 * stale mention in commentary.
 */
export function moduleDeclaresToken(
  moduleSource: string,
  token: string,
): boolean {
  let stripped = moduleSource.replace(/\\\*[^\n]*/g, "");
  // TLA+ block comments nest; strip innermost-first until none remain.
  for (
    let previous = "";
    previous !== stripped;
    stripped = stripped.replace(/\(\*(?:(?!\(\*)[\s\S])*?\*\)/g, "")
  ) {
    previous = stripped;
  }

  const definitionPattern = new RegExp(
    `(?:^|\\n)[ \\t]*${token}[ \\t]*(?:\\([^)]*\\))?[ \\t]*==`,
  );
  if (definitionPattern.test(stripped)) {
    return true;
  }
  return declaredTlaNames(stripped).includes(token);
}

/**
 * Names introduced by VARIABLES/CONSTANTS declarations: the keyword's own
 * line plus only its comma-continued follow-on lines, so a bare use in a
 * later definition is never misread as a declaration.
 */
export function declaredTlaNames(strippedModule: string): string[] {
  const names: string[] = [];
  const lines = strippedModule.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = (lines[index] ?? "").match(
      /^[ \t]*(?:VARIABLES?|CONSTANTS?)\b(.*)$/,
    );
    if (!match) {
      continue;
    }
    let declaration = match[1] ?? "";
    while (declaration.trimEnd().endsWith(",") && index + 1 < lines.length) {
      index += 1;
      declaration += `,${lines[index] ?? ""}`;
    }
    for (const name of declaration.split(",")) {
      const identifier = name.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
        names.push(identifier);
      }
    }
  }
  return names;
}

/**
 * Strip comments and string/template literals so a seam surviving only in
 * commentary or documentation strings does not count as code. The removal is
 * lexical rather than a full parse; that is enough to keep matches to code.
 */
export function stripTsCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const WIRE_TAG_PATTERN = /^[a-z0-9]+(?:[._][a-z0-9]+)+$/;

/**
 * All segments of a dotted seam must occur together in one file, in actual
 * code. Snake_case wire tags are string contracts, so they must instead occur
 * as quoted literals.
 */
function productionSeamExists(
  productionFiles: readonly FormalSourceFile[],
  strippedByPath: ReadonlyMap<string, string>,
  token: string,
): boolean {
  if (WIRE_TAG_PATTERN.test(token)) {
    return productionFiles.some((file) =>
      new RegExp(`["'\`]${token.replaceAll(".", "\\.")}["'\`]`).test(
        file.content,
      ),
    );
  }
  const segments = token.split(".").filter((segment) => segment.length > 0);
  return productionFiles.some((file) => {
    const stripped = strippedByPath.get(file.path) ?? "";
    return segments.every((segment) => hasWordOccurrence(stripped, segment));
  });
}

export function verifyAbstractionMaps(input: {
  readonly docs: readonly FormalSourceFile[];
  readonly expectedTables: Readonly<Record<string, number>>;
  readonly modulesByPath: ReadonlyMap<string, string>;
  readonly productionFiles: readonly FormalSourceFile[];
}): string[] {
  const collected = collectMappedTokens(input.docs);
  const { tablesByDoc, tokens } = collected;
  const problems: string[] = [...collected.problems];
  const strippedByPath = new Map(
    input.productionFiles.map((file) => [
      file.path,
      stripTsCommentsAndStrings(file.content),
    ]),
  );

  for (const [doc, expected] of Object.entries(input.expectedTables)) {
    const found = tablesByDoc.get(doc) ?? 0;
    if (found !== expected) {
      problems.push(
        `${doc}: expected ${expected} abstraction-map tables, found ${found}. Update the registry in scripts/lintFormalAbstractionMaps.ts alongside intentional map changes.`,
      );
    }
  }
  for (const [doc, found] of tablesByDoc) {
    if (!(doc in input.expectedTables)) {
      problems.push(
        `${doc}: carries ${found} abstraction-map tables but is not registered in scripts/lintFormalAbstractionMaps.ts.`,
      );
    }
  }

  for (const entry of tokens) {
    if (entry.side === "model") {
      const module = input.modulesByPath.get(entry.module);
      if (module === undefined) {
        problems.push(
          `${entry.doc}:${entry.line}: documented module ${entry.module} does not exist.`,
        );
      } else if (!moduleDeclaresToken(module, entry.token)) {
        problems.push(
          `${entry.doc}:${entry.line}: \`${entry.token}\` is not declared in ${entry.module}`,
        );
      }
    } else if (
      !productionSeamExists(input.productionFiles, strippedByPath, entry.token)
    ) {
      problems.push(
        `${entry.doc}:${entry.line}: \`${entry.token}\` not found together in any production package source file`,
      );
    }
  }

  return problems;
}

/**
 * Production seams must live in production-reachable source: exclude test
 * files, test-named modules (fixtures, factories, helpers), test directories,
 * and the two test-support packages, so a seam surviving only in test support
 * still fails. The production check verifies the named seams exist there —
 * existence, not call-site binding; the module-bound model side plus these
 * exclusions keep a rename or removal from passing on leftovers.
 */
export function isProductionSourcePath(path: string): boolean {
  const segments = path.split(/[\\/]/);
  return (
    /\.(ts|tsx)$/.test(path) &&
    segments.includes("src") &&
    !/(^|[^a-z])test|Test/.test(segments.at(-1) ?? "") &&
    !segments.some((segment) =>
      ["__tests__", "fixtures", "test", "tests"].includes(segment),
    ) &&
    !path.includes(join("packages", "test-utils", "")) &&
    !path.includes(join("packages", "bob-and-alice", ""))
  );
}

function walkFiles(root: string, matches: (path: string) => boolean): string[] {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }
    for (const name of readdirSync(directory)) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
        continue;
      }
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        pending.push(path);
      } else if (matches(path)) {
        found.push(path);
      }
    }
  }
  return found.sort();
}

function readSourceFiles(paths: readonly string[]): FormalSourceFile[] {
  return paths.map((path) => ({
    content: readFileSync(path, "utf8"),
    path,
  }));
}

if (import.meta.main) {
  const root = process.cwd();
  const toRelative = (file: FormalSourceFile): FormalSourceFile => ({
    content: file.content,
    path: relative(root, resolve(root, file.path)),
  });
  const docs = readSourceFiles(
    walkFiles(join(root, "formal"), (path) => path.endsWith(".md")),
  ).map(toRelative);
  const modules = readSourceFiles(
    walkFiles(join(root, "formal"), (path) => path.endsWith(".tla")),
  ).map(toRelative);
  const productionFiles = readSourceFiles(
    walkFiles(join(root, "packages"), isProductionSourcePath),
  );

  const problems = verifyAbstractionMaps({
    docs,
    expectedTables: EXPECTED_TABLES,
    modulesByPath: new Map(
      modules.map((module) => [module.path, module.content]),
    ),
    productionFiles,
  });

  if (problems.length > 0) {
    console.error(
      "error formal-abstraction-maps: the documented maps drifted from the code. Update the map (and its registry) alongside the rename or removal.",
    );
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exit(1);
  }

  const { tablesByDoc, tokens } = collectMappedTokens(docs);
  const tables = [...tablesByDoc.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  console.log(
    `Checked ${tokens.length} abstraction-map tokens across ${tables} tables.`,
  );
}
