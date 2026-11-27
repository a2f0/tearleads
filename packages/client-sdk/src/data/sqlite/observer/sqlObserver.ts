/**
 * Opt-in, zero-overhead-when-unused observer registry for client SQLite
 * statements and serialized mutation lock holds. Designed for measurement
 * harnesses (`@tearleads/performance`) and tests; production registers none.
 *
 * Raw bind values are never passed to observers — only `bindCount` — and a
 * re-entrancy guard stops an observer from recursing into itself.
 */

export interface ObservedClientSqlStatement {
  readonly sql: string;
  readonly bindCount: number;
  readonly durationMs: number;
  readonly rowCount: number;
  readonly inMutationLock: boolean;
  readonly failed: boolean;
}

export interface ObservedClientSqlMutation {
  readonly waitMs: number;
  readonly holdMs: number;
  readonly statements: number;
  readonly failed: boolean;
}

export type ClientSqlStatementObserver = (
  statement: ObservedClientSqlStatement,
) => void;

export type ClientSqlMutationObserver = (
  mutation: ObservedClientSqlMutation,
) => void;

const statementObservers = new Set<ClientSqlStatementObserver>();
const mutationObservers = new Set<ClientSqlMutationObserver>();

let notifyingStatement = false;
let notifyingMutation = false;

export function observeClientSqlStatements(
  observer: ClientSqlStatementObserver,
): () => void {
  statementObservers.add(observer);
  return () => {
    statementObservers.delete(observer);
  };
}

export function observeClientSqlMutations(
  observer: ClientSqlMutationObserver,
): () => void {
  mutationObservers.add(observer);
  return () => {
    mutationObservers.delete(observer);
  };
}

export function hasClientSqlStatementObservers(): boolean {
  return statementObservers.size > 0 && !notifyingStatement;
}

export function hasClientSqlMutationObservers(): boolean {
  return mutationObservers.size > 0 && !notifyingMutation;
}

export function notifyClientSqlStatement(
  statement: ObservedClientSqlStatement,
): void {
  if (statementObservers.size === 0 || notifyingStatement) return;
  notifyingStatement = true;
  try {
    for (const observer of statementObservers) observer(statement);
  } finally {
    notifyingStatement = false;
  }
}

export function notifyClientSqlMutation(
  mutation: ObservedClientSqlMutation,
): void {
  if (mutationObservers.size === 0 || notifyingMutation) return;
  notifyingMutation = true;
  try {
    for (const observer of mutationObservers) observer(mutation);
  } finally {
    notifyingMutation = false;
  }
}
