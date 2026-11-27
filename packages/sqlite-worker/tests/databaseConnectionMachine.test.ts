import { expect, test } from "bun:test";
import {
  canOpenDatabaseConnection,
  type DatabaseConnectionEvent,
  type DatabaseConnectionState,
  databaseConnectionDbName,
  databaseConnectionRefusal,
  transitionDatabaseConnection,
  UNOPENED_DATABASE_CONNECTION,
} from "../src/databaseConnectionMachine";
import {
  DATABASE_DELETED_MESSAGE,
  DATABASE_NOT_INITIALIZED_MESSAGE,
} from "../src/types";

const open: DatabaseConnectionState = { dbName: "a.db", status: "open" };
const deleted = { status: "deleted" } as const;
const opening = (
  attempt: number,
  { afterDelete = false, released = false } = {},
): Extract<DatabaseConnectionState, { status: "opening" }> => ({
  afterDelete,
  attempt,
  released,
  status: "opening",
});

test.each<
  [
    string,
    DatabaseConnectionState,
    DatabaseConnectionEvent,
    DatabaseConnectionState,
  ]
>([
  [
    "an open starts from no database",
    UNOPENED_DATABASE_CONNECTION,
    { attempt: 1, type: "openStarted" },
    opening(1),
  ],
  [
    "an open starts again after a delete elsewhere, still answering deleted",
    deleted,
    { attempt: 2, type: "openStarted" },
    opening(2, { afterDelete: true }),
  ],
  [
    "the open's own attempt succeeding opens the database",
    opening(1),
    { attempt: 1, dbName: "a.db", type: "openSucceeded" },
    open,
  ],
  [
    "a successful open after a delete elsewhere opens the database",
    opening(1, { afterDelete: true }),
    { attempt: 1, dbName: "a.db", type: "openSucceeded" },
    open,
  ],
  [
    "an older attempt succeeding changes nothing",
    opening(2),
    { attempt: 1, dbName: "a.db", type: "openSucceeded" },
    opening(2),
  ],
  [
    "the open's own attempt failing leaves no database",
    opening(1),
    { attempt: 1, type: "openFailed" },
    UNOPENED_DATABASE_CONNECTION,
  ],
  [
    "a failed open after a delete elsewhere still answers deleted",
    opening(1, { afterDelete: true }),
    { attempt: 1, type: "openFailed" },
    deleted,
  ],
  [
    "a close during an open waits for the open to settle",
    opening(1),
    { type: "released" },
    opening(1, { released: true }),
  ],
  [
    "a second close during an open changes nothing",
    opening(1, { released: true }),
    { type: "released" },
    opening(1, { released: true }),
  ],
  [
    "an open a close overtook settles with no database",
    opening(1, { released: true }),
    { attempt: 1, dbName: "a.db", type: "openSucceeded" },
    UNOPENED_DATABASE_CONNECTION,
  ],
  [
    "an open a close overtook after a delete elsewhere still answers deleted",
    opening(1, { afterDelete: true, released: true }),
    { attempt: 1, dbName: "a.db", type: "openSucceeded" },
    deleted,
  ],
  [
    "a failed open a close overtook leaves no database",
    opening(1, { released: true }),
    { attempt: 1, type: "openFailed" },
    UNOPENED_DATABASE_CONNECTION,
  ],
  [
    "a close releases an open database",
    open,
    { type: "released" },
    UNOPENED_DATABASE_CONNECTION,
  ],
  [
    "a deleted connection keeps saying so after a close",
    deleted,
    { type: "released" },
    deleted,
  ],
  [
    "a delete elsewhere marks an open connection deleted",
    open,
    { type: "deletedElsewhere" },
    deleted,
  ],
  [
    "a delete elsewhere leaves a closed connection unopened",
    UNOPENED_DATABASE_CONNECTION,
    { type: "deletedElsewhere" },
    UNOPENED_DATABASE_CONNECTION,
  ],
  [
    "a database the worker no longer has open leaves the connection unopened",
    open,
    { type: "databaseClosed" },
    UNOPENED_DATABASE_CONNECTION,
  ],
  // Events a state ignores.
  [
    "a second open while one is in flight changes nothing",
    opening(1),
    { attempt: 2, type: "openStarted" },
    opening(1),
  ],
  [
    "an open on an open connection changes nothing",
    open,
    { attempt: 2, type: "openStarted" },
    open,
  ],
  [
    "a failed open the close already settled changes nothing",
    UNOPENED_DATABASE_CONNECTION,
    { attempt: 1, type: "openFailed" },
    UNOPENED_DATABASE_CONNECTION,
  ],
  [
    "a failed open after a delete elsewhere settled changes nothing",
    deleted,
    { attempt: 1, type: "openFailed" },
    deleted,
  ],
  [
    "a stale open result on an open connection changes nothing",
    open,
    { attempt: 1, dbName: "b.db", type: "openSucceeded" },
    open,
  ],
  [
    "a stale failed open on an open connection changes nothing",
    open,
    { attempt: 1, type: "openFailed" },
    open,
  ],
  [
    "a delete elsewhere during an open changes nothing",
    opening(1),
    { type: "deletedElsewhere" },
    opening(1),
  ],
  [
    "a closed database during an open changes nothing",
    opening(1),
    { type: "databaseClosed" },
    opening(1),
  ],
  [
    "a closed database leaves a deleted connection deleted",
    deleted,
    { type: "databaseClosed" },
    deleted,
  ],
])("%s", (_name, state, event, expected) => {
  expect(transitionDatabaseConnection(state, event)).toEqual(expected);
});

test("each state answers statements and opens as the registry did before", () => {
  expect(databaseConnectionRefusal(deleted)).toBe(DATABASE_DELETED_MESSAGE);
  expect(databaseConnectionRefusal({ status: "unopened" })).toBe(
    DATABASE_NOT_INITIALIZED_MESSAGE,
  );
  expect(databaseConnectionRefusal(opening(1, { released: true }))).toBe(
    DATABASE_NOT_INITIALIZED_MESSAGE,
  );
  expect(databaseConnectionRefusal(opening(1, { afterDelete: true }))).toBe(
    DATABASE_DELETED_MESSAGE,
  );

  expect(canOpenDatabaseConnection(open)).toBe(false);
  expect(canOpenDatabaseConnection(opening(1))).toBe(false);
  expect(canOpenDatabaseConnection(opening(1, { released: true }))).toBe(false);
  expect(canOpenDatabaseConnection(deleted)).toBe(true);

  expect(databaseConnectionDbName(open)).toBe("a.db");
  expect(databaseConnectionDbName(deleted)).toBeNull();
});
