import {
  isDatabaseTransactionBusyError,
  isDatabaseUnavailableError,
} from "./databaseUnavailable";

/**
 * What a failed database call says about the work that made it.
 *
 * - `busy`: the SQLite worker refused the statement unrun because another
 *   tab held a transaction past the lease's wait bound. The same work succeeds
 *   once that transaction ends, so it never counts against the work's own
 *   failure budget.
 * - `unavailable`: the database went away underneath the work. Callers wait
 *   for the database to be ready again rather than retrying on a schedule.
 * - `failed`: anything else, which is the work's own failure.
 */
export type DatabaseFailureKind = "busy" | "unavailable" | "failed";

export function classifyDatabaseFailure(error: unknown): DatabaseFailureKind {
  if (isDatabaseTransactionBusyError(error)) return "busy";
  if (isDatabaseUnavailableError(error)) return "unavailable";
  return "failed";
}

/**
 * How many times one piece of work is run while each run is refused as busy.
 * The SDK's worker refuses only after waiting its 5 s lease bound, so this
 * waits out roughly 25 s of another tab's continuous transaction before the
 * work gives up for now; it then fails with the busy refusal, which its caller
 * keeps out of any failure budget.
 */
export const DATABASE_BUSY_RUN_LIMIT = 5;

// A host worker that refuses at once must not be asked again in a tight loop.
const DATABASE_BUSY_RETRY_PAUSE_MS = 100;

interface DatabaseBusyRetryOptions {
  /** Stops retrying once the work no longer belongs to the current scope. */
  readonly isCurrent?: (() => boolean) | undefined;
  /** Told each time a run was refused and the work will run again. */
  readonly onBusy?: ((refusals: number) => void) | undefined;
}

/**
 * Runs `work` again each time the worker refuses it as busy, up to
 * {@link DATABASE_BUSY_RUN_LIMIT} runs. A refused statement did not run, and
 * the worker never refuses a statement of the connection that holds the
 * transaction, so a refusal can only reach work that has no transaction open:
 * running it again is safe whenever the work tolerates repeating whatever
 * finished before the refusal, its committed statements and any network
 * requests alike. Any other failure is thrown at once.
 */
export async function retryWhileDatabaseBusy<T>(
  work: () => Promise<T>,
  options: DatabaseBusyRetryOptions = {},
): Promise<T> {
  for (let refusals = 1; ; refusals += 1) {
    try {
      return await work();
    } catch (error) {
      if (
        classifyDatabaseFailure(error) !== "busy" ||
        refusals >= DATABASE_BUSY_RUN_LIMIT
      ) {
        throw error;
      }
      options.onBusy?.(refusals);
      await new Promise((resolve) =>
        setTimeout(resolve, DATABASE_BUSY_RETRY_PAUSE_MS),
      );
      if (options.isCurrent?.() === false) throw error;
    }
  }
}
