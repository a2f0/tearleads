import {
  type PrincipalMutationJournalScope,
  principalMutationJournalScopeId,
} from "../../data/principals/principalMutationJournal";
import {
  type ExecSql,
  resolveCanonicalExecSql,
} from "../../data/sqlite/sqlSchema";

const lanes = new WeakMap<ExecSql, Map<string, Promise<void>>>();

/** An owned dispatch finishes before another caller can recover or abandon it. */
export async function runPrincipalMutationJournalOperation<T>(
  execSql: ExecSql,
  scope: PrincipalMutationJournalScope,
  run: () => Promise<T>,
): Promise<T> {
  const executor = resolveCanonicalExecSql(execSql);
  const scopeId = await principalMutationJournalScopeId(scope);
  let active = lanes.get(executor);
  if (!active) {
    active = new Map();
    lanes.set(executor, active);
  }
  const pending = (active.get(scopeId) ?? Promise.resolve()).then(run);
  const settled = pending.then(
    () => {},
    () => {},
  );
  active.set(scopeId, settled);
  try {
    return await pending;
  } finally {
    if (active.get(scopeId) === settled) active.delete(scopeId);
    if (active.size === 0) lanes.delete(executor);
  }
}
