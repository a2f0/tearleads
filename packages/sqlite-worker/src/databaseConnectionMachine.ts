import {
  DATABASE_DELETED_MESSAGE,
  DATABASE_NOT_INITIALIZED_MESSAGE,
} from "./types";

/**
 * One worker connection's hold on a database.
 *
 * - `unopened`: no database: never opened, closed, its open failed, or the
 *   worker no longer has its database open.
 * - `opening`: an `init` is in flight, tagged by `attempt`. `released` says
 *   the connection closed or deleted during the open. The open then gives
 *   back what it acquired and fails, and until that release has finished the
 *   connection cannot start another `init`. `afterDelete` says another
 *   connection had deleted the database, which the connection keeps
 *   answering until an open succeeds.
 * - `open`: the connection's statements run on `dbName`.
 * - `deleted`: another connection deleted its database. It answers so until
 *   it opens one again, so a deliberate delete never reads as a database that
 *   was never opened.
 * - `revoked`: the worker rolled back its transaction after it sat idle while
 *   another connection waited (see `transactionLeaseMachine.ts`). Every
 *   statement is answered `refusal` until it opens the database again; a
 *   delete still deletes `dbName`.
 */
export type DatabaseConnectionState =
  | { readonly status: "unopened" }
  | {
      readonly status: "opening";
      readonly attempt: number;
      readonly afterDelete: boolean;
      readonly released: boolean;
    }
  | { readonly status: "open"; readonly dbName: string }
  | { readonly status: "deleted" }
  | {
      readonly status: "revoked";
      readonly dbName: string;
      readonly refusal: string;
    };

export type DatabaseConnectionEvent =
  | { readonly type: "openStarted"; readonly attempt: number }
  | {
      readonly type: "openSucceeded";
      readonly attempt: number;
      readonly dbName: string;
    }
  | { readonly type: "openFailed"; readonly attempt: number }
  // The connection asked to close, or to delete its own database.
  | { readonly type: "released" }
  // Another connection deleted the connection's database.
  | { readonly type: "deletedElsewhere" }
  // The worker rolled back the connection's idle transaction.
  | { readonly type: "transactionRevoked"; readonly refusal: string }
  // The worker no longer has the connection's database open, or closed it
  // because its handle could not leave a transaction.
  | { readonly type: "databaseClosed" };

export const UNOPENED_DATABASE_CONNECTION: DatabaseConnectionState = {
  status: "unopened",
};
const DELETED_DATABASE_CONNECTION: DatabaseConnectionState = {
  status: "deleted",
};

// Where an open that did not succeed leaves the connection.
function settledOpen(
  state: Extract<DatabaseConnectionState, { status: "opening" }>,
): DatabaseConnectionState {
  return state.afterDelete
    ? DELETED_DATABASE_CONNECTION
    : UNOPENED_DATABASE_CONNECTION;
}

// An open's own attempt settling; another attempt's result changes nothing.
function settleOpenAttempt(
  state: DatabaseConnectionState,
  event: Extract<
    DatabaseConnectionEvent,
    { type: "openSucceeded" | "openFailed" }
  >,
): DatabaseConnectionState {
  if (state.status !== "opening" || state.attempt !== event.attempt) {
    return state;
  }
  return event.type === "openSucceeded" && !state.released
    ? { status: "open", dbName: event.dbName }
    : settledOpen(state);
}

// The worker took an open connection's database away.
function retireOpenConnection(
  state: Extract<DatabaseConnectionState, { status: "open" }>,
  event: Extract<
    DatabaseConnectionEvent,
    { type: "deletedElsewhere" | "transactionRevoked" | "databaseClosed" }
  >,
): DatabaseConnectionState {
  switch (event.type) {
    case "deletedElsewhere":
      return DELETED_DATABASE_CONNECTION;
    case "transactionRevoked":
      return {
        status: "revoked",
        dbName: state.dbName,
        refusal: event.refusal,
      };
    case "databaseClosed":
      return UNOPENED_DATABASE_CONNECTION;
  }
}

export function transitionDatabaseConnection(
  state: DatabaseConnectionState,
  event: DatabaseConnectionEvent,
): DatabaseConnectionState {
  switch (event.type) {
    case "openStarted":
      return state.status === "opening" || state.status === "open"
        ? state
        : {
            afterDelete: state.status === "deleted",
            attempt: event.attempt,
            released: false,
            status: "opening",
          };
    case "openSucceeded":
    case "openFailed":
      return settleOpenAttempt(state, event);
    case "released":
      if (state.status === "opening") {
        return { ...state, released: true };
      }
      // A deleted connection keeps saying so until it opens again.
      return state.status === "deleted" ? state : UNOPENED_DATABASE_CONNECTION;
    case "deletedElsewhere":
    case "transactionRevoked":
    case "databaseClosed":
      return state.status === "open"
        ? retireOpenConnection(state, event)
        : state;
  }
}

/** Whether the connection may start an `init`. */
export function canOpenDatabaseConnection(
  state: DatabaseConnectionState,
): boolean {
  return state.status !== "opening" && state.status !== "open";
}

/** The answer to a statement on a connection with no open database. */
export function databaseConnectionRefusal(
  state: Exclude<DatabaseConnectionState, { status: "open" }>,
): string {
  switch (state.status) {
    case "deleted":
      return DATABASE_DELETED_MESSAGE;
    case "revoked":
      return state.refusal;
    case "opening":
      return state.afterDelete
        ? DATABASE_DELETED_MESSAGE
        : DATABASE_NOT_INITIALIZED_MESSAGE;
    case "unopened":
      return DATABASE_NOT_INITIALIZED_MESSAGE;
  }
}

/** The database a connection's delete removes, if it has one. */
export function databaseConnectionDbName(
  state: DatabaseConnectionState,
): string | null {
  return state.status === "open" || state.status === "revoked"
    ? state.dbName
    : null;
}
