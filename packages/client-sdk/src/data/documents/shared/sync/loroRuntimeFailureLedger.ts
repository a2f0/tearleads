/**
 * How many process lifetimes must each fail the Loro runtime on a served
 * update before this device voids it. Below this the update is unsettled:
 * its pull keeps the cursor before it and a later pull judges it again.
 */
export const MAX_LORO_RUNTIME_ATTEMPTS = 3;

const FIRST_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;

/**
 * What this process has seen of Loro runtime failures. A trap can leave the
 * module unusable for the rest of the process, so a failure after the first
 * one says nothing about its update, and only the process's first failure
 * counts as an attempt. An update that failed here is not imported again
 * until its retry delay, doubling with each failure, has passed.
 */
export class LoroRuntimeFailureLedger {
  private failedInProcess = false;
  private readonly retries = new Map<
    string,
    { readonly delayMs: number; readonly retryAt: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  /** Whether `updateId` may be imported now. */
  mayAttempt(updateId: string): boolean {
    const retry = this.retries.get(updateId);
    return retry === undefined || this.now() >= retry.retryAt;
  }

  /** Notes `updateId` failing; true when the failure counts as an attempt. */
  noteFailure(updateId: string): boolean {
    const counted = !this.failedInProcess;
    this.failedInProcess = true;
    const previous = this.retries.get(updateId);
    const delayMs =
      previous === undefined
        ? FIRST_RETRY_DELAY_MS
        : Math.min(previous.delayMs * 2, MAX_RETRY_DELAY_MS);
    this.retries.set(updateId, { delayMs, retryAt: this.now() + delayMs });
    return counted;
  }

  /** Notes a failure no single update is to blame for (a scratch rebuild). */
  noteUnattributedFailure(): void {
    this.failedInProcess = true;
  }
}

/** The process's ledger; tests pass their own to stand for a new process. */
export const processLoroRuntimeFailures = new LoroRuntimeFailureLedger();
