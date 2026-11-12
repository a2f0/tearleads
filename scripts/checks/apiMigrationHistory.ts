// Deployed databases have applied every migration on the base branch, and
// Drizzle never re-reads an applied one, so a branch may only append
// migrations that sort after the base's newest.

export const apiMigrationsPath = "packages/api-shared/drizzle";
const journalPath = "meta/_journal.json";

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

/** Migration folder files by path relative to the folder. */
export type MigrationFiles = ReadonlyMap<string, string>;

function readEntries(files: MigrationFiles, label: string): JournalEntry[] {
  const journal = files.get(journalPath);
  if (journal === undefined) throw new Error(`${label} has no ${journalPath}`);
  const parsed: unknown = JSON.parse(journal);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(`${label} ${journalPath} has no entries array`);
  }
  return parsed.entries.map((entry: unknown, index: number) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("idx" in entry) ||
      !("tag" in entry) ||
      !("when" in entry) ||
      typeof entry.idx !== "number" ||
      typeof entry.tag !== "string" ||
      typeof entry.when !== "number"
    ) {
      throw new Error(`${label} ${journalPath} entry ${index} is malformed`);
    }
    return { idx: entry.idx, tag: entry.tag, when: entry.when };
  });
}

function snapshotPath(idx: number): string {
  return `meta/${String(idx).padStart(4, "0")}_snapshot.json`;
}

function appendedEntryErrors(
  head: MigrationFiles,
  entries: ReadonlyArray<JournalEntry>,
  baseCount: number,
): string[] {
  const errors: string[] = [];
  for (const [index, entry] of entries.entries()) {
    if (index < baseCount) continue;
    const previous = entries[index - 1];
    if (previous && entry.when <= previous.when) {
      errors.push(
        `${entry.tag} sorts before ${previous.tag}; delete it and generate it again after merging the base branch`,
      );
    }
    if (entry.idx !== index) {
      errors.push(
        `${entry.tag} has journal idx ${entry.idx}; expected ${index}`,
      );
    }
    if (!head.has(`${entry.tag}.sql`)) {
      errors.push(`${entry.tag}.sql is missing`);
    }
    if (!head.has(snapshotPath(entry.idx))) {
      errors.push(`${snapshotPath(entry.idx)} for ${entry.tag} is missing`);
    }
  }
  return errors;
}

/** Every way `head` fails to append to `base`; empty when it only appends. */
export function apiMigrationHistoryErrors(
  base: MigrationFiles,
  head: MigrationFiles,
): string[] {
  const errors: string[] = [];
  for (const [path, content] of base) {
    if (path === journalPath) continue;
    const current = head.get(path);
    if (current === undefined) {
      errors.push(`${path} was removed; shipped migrations are permanent`);
    } else if (current !== content) {
      errors.push(`${path} was edited; add a new migration instead`);
    }
  }
  const baseEntries = readEntries(base, "The base");
  const headEntries = readEntries(head, "This branch");
  for (const [index, entry] of baseEntries.entries()) {
    const current = headEntries[index];
    if (
      current?.tag !== entry.tag ||
      current.when !== entry.when ||
      current.idx !== entry.idx
    ) {
      errors.push(
        `journal entry ${index} (${entry.tag}) changed; shipped journal entries are permanent`,
      );
    }
  }
  return [
    ...errors,
    ...appendedEntryErrors(head, headEntries, baseEntries.length),
  ];
}
