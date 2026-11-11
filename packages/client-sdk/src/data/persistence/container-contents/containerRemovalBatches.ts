import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";

// A hydration fence binds five values per row plus one conflict-update value.
// The cascade's IN predicates (including repeated ids) fit this bound too.
const REMOVAL_BATCH_SIZE = sqliteRowsPerStatement(5, 1);

export function* containerRemovalBatches<T>(values: ReadonlyArray<T>) {
  for (let offset = 0; offset < values.length; offset += REMOVAL_BATCH_SIZE) {
    yield values.slice(offset, offset + REMOVAL_BATCH_SIZE);
  }
}
