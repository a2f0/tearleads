import { processLoroLifetimes } from "./loroLifetime";
import { processLoroRuntimeHealth } from "./loroRuntimeHealth";

/**
 * How many process lifetimes must each fail the Loro runtime on a served
 * update before this device voids it. Below this the update is unsettled:
 * its pull keeps the cursor before it and a later pull judges it again.
 */
export const MAX_LORO_RUNTIME_ATTEMPTS = 3;

const FIRST_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;

/** How a judge learns whether to read an update and notes a failure. */
export interface LoroRuntimeAttempts {
  /** Whether this process has met a Loro runtime failure. */
  hasFailed(): boolean;
  /** Whether `updateId` may be imported now. */
  mayAttempt(updateId: string): boolean;
  /** Notes `updateId` failing; true when the failure counts as an attempt. */
  noteFailure(updateId: string): boolean;
  /** Notes a failure no single update is to blame for (a scratch rebuild). */
  noteUnattributedFailure(): void;
}

/**
 * What this process has seen of Loro runtime failures. A trap can leave the
 * module unusable for the rest of the process, so a failure after the first
 * one says nothing about its update, and only the process's first failure
 * counts as an attempt. An update that failed here is not imported again
 * until its retry delay, doubling with each failure, has passed.
 */
export class LoroRuntimeFailureLedger implements LoroRuntimeAttempts {
  private failedInProcess = false;
  private readonly retries = new Map<
    string,
    { readonly delayMs: number; readonly retryAt: number }
  >();

  /**
   * `onFirstFailure` runs once, at the process's first failure, so a Loro
   * read window open anywhere stops counting a death (`loroLifetime.ts`),
   * and the realm asks its host for a restart (`loroRuntimeHealth.ts`).
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly onFirstFailure: () => void = () => undefined,
  ) {}

  private markFailed(): void {
    if (this.failedInProcess) return;
    this.failedInProcess = true;
    this.onFirstFailure();
  }

  /** Whether this process has met a Loro runtime failure. */
  hasFailed(): boolean {
    return this.failedInProcess;
  }

  /** Whether `updateId` may be imported now. */
  mayAttempt(updateId: string): boolean {
    const retry = this.retries.get(updateId);
    return retry === undefined || this.now() >= retry.retryAt;
  }

  /** Notes `updateId` failing; true when the failure counts as an attempt. */
  noteFailure(updateId: string): boolean {
    const counted = !this.failedInProcess;
    this.markFailed();
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
    this.markFailed();
  }

  /**
   * The view a judge that records no attempts uses (rotation, a founding
   * view): every update may be read, and a failure counts toward none and
   * delays none, but still marks this process as failed, since the module
   * may be unusable for the sync judge that does count.
   */
  unrecorded(): LoroRuntimeAttempts {
    return {
      hasFailed: () => this.failedInProcess,
      mayAttempt: () => true,
      noteFailure: () => {
        this.noteUnattributedFailure();
        return false;
      },
      noteUnattributedFailure: () => this.noteUnattributedFailure(),
    };
  }
}

/** The process's ledger; tests pass their own to stand for a new process. */
export const processLoroRuntimeFailures = new LoroRuntimeFailureLedger(
  Date.now,
  () => {
    processLoroLifetimes.noteFailed();
    processLoroRuntimeHealth.noteRuntimeFailed();
  },
);
