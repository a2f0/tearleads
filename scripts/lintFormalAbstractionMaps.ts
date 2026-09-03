/**
 * Executable check for the formal abstraction maps: every backticked model
 * operator named in a `Model action … | Production …` table under formal/
 * must occur in a registered TLA+ module, and every backticked production
 * seam must occur in production package source. A rename or deletion on
 * either side of the map fails this check instead of silently making the
 * documentation prose-only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TABLE_HEADER_PATTERN =
  /^\|\s*Model action(?: or predicate)?\s*\|\s*Production (?:implementation|seam)\s*\|$/;
const MINIMUM_EXPECTED_TABLES = 4;

interface MappedToken {
  readonly doc: string;
  readonly line: number;
  readonly side: "model" | "production";
  readonly token: string;
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

function readCorpus(paths: readonly string[]): string {
  return paths.map((path) => readFileSync(path, "utf8")).join("\n");
}

function extractBacktickedTokens(cell: string): string[] {
  const tokens: string[] = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    const token = match[1] ?? "";
    // The maps name identifiers, wire tags, and dotted member accesses; any
    // other shape means the table format drifted, which should fail loudly
    // rather than pass unchecked.
    if (!/^[A-Za-z0-9_.]+$/.test(token)) {
      throw new Error(`unexpected abstraction-map token shape: \`${token}\``);
    }
    // A dotted token names a type plus member; each segment must exist.
    tokens.push(...token.split(".").filter((segment) => segment.length > 0));
  }
  return tokens;
}

function rowTokens(doc: string, line: number, cells: string): MappedToken[] {
  const parts = cells.split("|").map((cell) => cell.trim());
  const sides = [
    ["model", parts[1] ?? ""],
    ["production", parts[2] ?? ""],
  ] as const;
  return sides.flatMap(([side, cell]) =>
    extractBacktickedTokens(cell).map((token) => ({ doc, line, side, token })),
  );
}

function tableTokens(
  doc: string,
  lines: readonly string[],
  headerIndex: number,
): { readonly nextIndex: number; readonly tokens: MappedToken[] } {
  const tokens: MappedToken[] = [];
  let row = headerIndex + 2; // skip the |---|---| separator
  for (; row < lines.length; row += 1) {
    const line = (lines[row] ?? "").trim();
    if (!line.startsWith("|")) {
      break;
    }
    tokens.push(...rowTokens(doc, row + 1, line));
  }
  if (row === headerIndex + 2) {
    throw new Error(`${doc}: abstraction-map table has no rows.`);
  }
  return { nextIndex: row - 1, tokens };
}

function collectMappedTokens(root: string): {
  readonly tables: number;
  readonly tokens: MappedToken[];
} {
  const docs = walkFiles(join(root, "formal"), (path) => path.endsWith(".md"));
  const tokens: MappedToken[] = [];
  let tables = 0;

  for (const doc of docs) {
    const relativeDoc = relative(root, doc);
    const lines = readFileSync(doc, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!TABLE_HEADER_PATTERN.test((lines[index] ?? "").trim())) {
        continue;
      }
      tables += 1;
      const table = tableTokens(relativeDoc, lines, index);
      tokens.push(...table.tokens);
      index = table.nextIndex;
    }
  }

  return { tables, tokens };
}

function hasWordOccurrence(corpus: string, token: string): boolean {
  return new RegExp(`\\b${token.replaceAll(".", "\\.")}\\b`).test(corpus);
}

const root = process.cwd();
const { tables, tokens } = collectMappedTokens(root);
if (tables < MINIMUM_EXPECTED_TABLES) {
  console.error(
    `error formal-abstraction-maps: found only ${tables} abstraction-map tables under formal/; expected at least ${MINIMUM_EXPECTED_TABLES}. The table headers may have drifted from the parser.`,
  );
  process.exit(1);
}

const modelCorpus = readCorpus(
  walkFiles(join(root, "formal"), (path) => path.endsWith(".tla")),
);
const productionCorpus = readCorpus(
  walkFiles(
    join(root, "packages"),
    (path) =>
      /\.(ts|tsx)$/.test(path) &&
      !/\.test\.(ts|tsx)$/.test(path) &&
      path.includes(`${join("src", "")}`),
  ),
);

const missing = tokens.filter(({ side, token }) =>
  side === "model"
    ? !hasWordOccurrence(modelCorpus, token)
    : !hasWordOccurrence(productionCorpus, token),
);

if (missing.length > 0) {
  console.error(
    "error formal-abstraction-maps: documented seams no longer exist. Update the abstraction map alongside the rename or removal.",
  );
  for (const entry of missing) {
    const where =
      entry.side === "model"
        ? "any formal/**/*.tla module"
        : "production package source";
    console.error(
      `  ${entry.doc}:${entry.line}: \`${entry.token}\` not found in ${where}`,
    );
  }
  process.exit(1);
}

console.log(
  `Checked ${tokens.length} abstraction-map tokens across ${tables} tables.`,
);
