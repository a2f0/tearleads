import {
  FREE_TRANSACTION_LEASE,
  mayRunUnderTransactionLease,
  type TransactionLeaseEvent,
  type TransactionLeaseState,
  transitionTransactionLease,
} from "./transactionLeaseMachine";
import { DATABASE_TRANSACTION_BUSY_MESSAGE, type SqliteRow } from "./types";

export interface TransactionLeaseBounds {
  readonly waitMs: number;
  readonly idleMs: number;
}

export interface TransactionLeaseRevocation {
  readonly idleMs: number;
  readonly waiting: number;
}

export interface TransactionLeaseHost<C> {
  /** Run `operation` after every operation already queued on the database. */
  readonly enqueue: (operation: () => void) => void;
  readonly isAutocommit: () => boolean;
  /** Roll back the handle's open transaction. May throw. */
  readonly rollback: () => void;
  /** Retire a holder whose transaction was rolled back after it stalled. */
  readonly revoke: (holder: C, revocation: TransactionLeaseRevocation) => void;
  /** The handle could not leave the transaction: close the database. */
  readonly fail: () => void;
  readonly now: () => number;
  readonly bounds: TransactionLeaseBounds;
}

interface PendingStatement<C> {
  readonly connection: C;
  readonly arrivedAt: number;
  readonly run: () => SqliteRow[];
  readonly resolve: (rows: SqliteRow[]) => void;
  readonly reject: (error: Error) => void;
  readonly settled: Promise<void>;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Schedules one open database's statements under its transaction lease (see
 * `transactionLeaseMachine.ts`). Statements wait in arrival order; the
 * holder's own statements pass the ones waiting for it. A statement that
 * waits `waitMs` for another connection's lease is refused and never runs,
 * and a holder that sends nothing for `idleMs` while another connection waits
 * has its transaction rolled back. Every statement runs inside the host's
 * queue, one at a time, so reading the handle's state after it is exact.
 */
export class TransactionLease<C> {
  private state: TransactionLeaseState<C> = FREE_TRANSACTION_LEASE;
  private readonly pending: PendingStatement<C>[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  // Set once when the database closes; nothing is scheduled after it.
  private disposed = false;

  constructor(private readonly host: TransactionLeaseHost<C>) {}

  submit(connection: C, run: () => SqliteRow[]): Promise<SqliteRow[]> {
    const done = Promise.withResolvers<SqliteRow[]>();
    const at = this.host.now();
    this.pending.push({
      arrivedAt: at,
      connection,
      reject: done.reject,
      resolve: done.resolve,
      run,
      settled: done.promise.then(
        () => undefined,
        () => undefined,
      ),
    });
    this.apply({ type: "statementArrived", connection, at });
    this.host.enqueue(() => this.pump());
    return done.promise;
  }

  /** Refuse `connection`'s waiting statements and end its transaction. */
  close(connection: C, refusal: string): void {
    this.refuse((statement) => statement.connection === connection, refusal);
    this.host.enqueue(() => {
      this.apply({ type: "holderClosed", connection });
      this.pump();
    });
  }

  /** Refuse `connection`'s waiting statements, leaving the lease alone. */
  refuseConnection(connection: C, refusal: string): void {
    this.refuse((statement) => statement.connection === connection, refusal);
  }

  /** The database is closing: refuse whatever still waits. */
  dispose(refusalFor: (connection: C) => string): void {
    this.disposed = true;
    this.clearTimer();
    for (const statement of this.pending.splice(0)) {
      statement.reject(new Error(refusalFor(statement.connection)));
    }
  }

  /** Settles once every statement `connection` submitted so far settled. */
  async settled(connection: C): Promise<void> {
    await Promise.all(
      this.pending
        .filter((statement) => statement.connection === connection)
        .map((statement) => statement.settled),
    );
  }

  private apply(event: TransactionLeaseEvent<C>): void {
    const previous = this.state;
    this.state = transitionTransactionLease(previous, event);
    if (this.state === previous) {
      return;
    }
    if (this.state.status === "releasing") {
      this.release(this.state);
    } else if (this.state.status === "failed") {
      this.host.fail();
    }
  }

  private release(
    state: Extract<TransactionLeaseState<C>, { status: "releasing" }>,
  ): void {
    try {
      this.host.rollback();
    } catch {
      // The handle's own state decides below whether the rollback took.
    }
    const autocommit = this.readAutocommit();
    if (state.cause === "holderStalled") {
      this.host.revoke(state.holder, {
        idleMs: state.idleMs,
        waiting: this.pending.filter(
          (statement) => statement.connection !== state.holder,
        ).length,
      });
    }
    this.apply({ type: "rolledBack", autocommit });
  }

  // A handle whose state cannot be read is treated as inside a transaction:
  // its connection keeps the lease, which the bounds still end.
  private readAutocommit(): boolean {
    try {
      return this.host.isAutocommit();
    } catch {
      return false;
    }
  }

  private pump(): void {
    while (!this.disposed) {
      const index = this.pending.findIndex((statement) =>
        mayRunUnderTransactionLease(this.state, statement.connection),
      );
      const statement = index < 0 ? undefined : this.pending[index];
      if (!statement) {
        break;
      }
      this.pending.splice(index, 1);
      this.runStatement(statement);
    }
    this.armTimer();
  }

  private runStatement(statement: PendingStatement<C>): void {
    let rows: SqliteRow[] = [];
    let failure: Error | null = null;
    try {
      rows = statement.run();
    } catch (error) {
      failure = toError(error);
    }
    this.apply({
      type: "statementSettled",
      connection: statement.connection,
      autocommit: this.readAutocommit(),
      at: this.host.now(),
    });
    if (failure) {
      statement.reject(failure);
    } else {
      statement.resolve(rows);
    }
  }

  private tick(): void {
    if (this.disposed) {
      return;
    }
    const at = this.host.now();
    const { state } = this;
    if (state.status === "held") {
      this.apply({
        type: "idleCheck",
        at,
        idleLimitMs: this.host.bounds.idleMs,
        othersWaiting: this.pending.some(
          (statement) => statement.connection !== state.holder,
        ),
        holderPending: this.pending.some(
          (statement) => statement.connection === state.holder,
        ),
      });
    }
    this.refuse(
      (statement) =>
        !mayRunUnderTransactionLease(this.state, statement.connection) &&
        at - statement.arrivedAt >= this.host.bounds.waitMs,
      DATABASE_TRANSACTION_BUSY_MESSAGE,
    );
    this.pump();
  }

  private armTimer(): void {
    this.clearTimer();
    if (this.disposed) {
      return;
    }
    const deadlines: number[] = [];
    for (const statement of this.pending) {
      if (!mayRunUnderTransactionLease(this.state, statement.connection)) {
        deadlines.push(statement.arrivedAt + this.host.bounds.waitMs);
      }
    }
    if (deadlines.length === 0) {
      return;
    }
    if (this.state.status === "held") {
      deadlines.push(this.state.activeAt + this.host.bounds.idleMs);
    }
    const delay = Math.max(0, Math.min(...deadlines) - this.host.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.host.enqueue(() => this.tick());
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private refuse(
    matches: (statement: PendingStatement<C>) => boolean,
    refusal: string,
  ): void {
    const refused = this.pending.filter(matches);
    if (refused.length === 0) {
      return;
    }
    const kept = this.pending.filter((statement) => !matches(statement));
    this.pending.splice(0, this.pending.length, ...kept);
    for (const statement of refused) {
      statement.reject(new Error(refusal));
    }
  }
}
