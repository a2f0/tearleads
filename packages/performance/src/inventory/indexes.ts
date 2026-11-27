export interface TableIndex {
  readonly name: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
  readonly primaryKey: boolean;
  readonly predicate: string | null;
}

export interface DuplicateIndexLead {
  readonly table: string;
  readonly indexName: string;
  readonly indexColumns: readonly string[];
  readonly coveredByName: string;
  readonly coveredByColumns: readonly string[];
  readonly reason: string;
}

function normalizePredicate(predicate: string | null): string {
  if (predicate === null) return "";
  return predicate.replace(/\s+/gu, " ").trim().toLowerCase();
}

function isLeadingPrefix(
  shorter: readonly string[],
  longer: readonly string[],
): boolean {
  if (shorter.length === 0 || shorter.length > longer.length) return false;
  for (let i = 0; i < shorter.length; i += 1) {
    if (shorter[i] !== longer[i]) return false;
  }
  return true;
}

function covers(candidate: TableIndex, target: TableIndex): boolean {
  if (candidate.name === target.name) return false;
  if (target.primaryKey) return false;
  if (target.unique) {
    // A unique index enforces a constraint; only another unique/PK index on the
    // exact same column list and predicate can make it redundant.
    if (!candidate.unique && !candidate.primaryKey) return false;
    if (candidate.columns.length !== target.columns.length) return false;
  }
  if (!isLeadingPrefix(target.columns, candidate.columns)) return false;
  const targetPred = normalizePredicate(target.predicate);
  const candidatePred = normalizePredicate(candidate.predicate);
  if (targetPred === candidatePred) return true;
  // A full (unfiltered) index can serve queries that a partial non-unique
  // index serves, though the partial index may still be kept intentionally for
  // size; only report exact predicate matches so leads stay high-signal.
  return false;
}

export function findLeftPrefixDuplicateIndexes(
  indexesByTable: ReadonlyMap<string, readonly TableIndex[]>,
): DuplicateIndexLead[] {
  const leads: DuplicateIndexLead[] = [];
  const sortedTables = [...indexesByTable.keys()].sort();
  for (const table of sortedTables) {
    const indexes = indexesByTable.get(table) ?? [];
    for (const target of indexes) {
      const covering = indexes.find((candidate) => covers(candidate, target));
      if (!covering) continue;
      const exact = covering.columns.length === target.columns.length;
      leads.push({
        table,
        indexName: target.name,
        indexColumns: target.columns,
        coveredByName: covering.name,
        coveredByColumns: covering.columns,
        reason: exact
          ? "exact duplicate column list and predicate"
          : "leading-column prefix covered by wider index",
      });
    }
  }
  return leads;
}
