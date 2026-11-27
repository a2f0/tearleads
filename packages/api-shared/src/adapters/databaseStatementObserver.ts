/**
 * `@tearleads/api-shared/statement-observer`: where a measurement harness
 * registers to see every statement the ORM sends. Only the ORM logger hands
 * statements to observers, and an architecture rule keeps this entry to
 * `packages/performance` and tests, since observers see raw bind values.
 */
export {
  type DatabaseRequestScopeObserver,
  type DatabaseStatementObserver,
  type ObservedDatabaseRequestScope,
  type ObservedDatabaseStatement,
  observeDatabaseRequestScopes,
  observeDatabaseStatements,
} from "./databaseStatementObserverRegistry";
