import { beginDatabaseWait } from "./databaseStatementCounter";

// Calls the driver's own method with the driver itself as `this`.
function invoke(target: object, method: string, args: unknown[]): unknown {
  return Reflect.apply(Reflect.get(target, method), target, args);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function wrapClient(client: unknown): unknown {
  return typeof client === "object" && client !== null
    ? timeDatabaseClient(client)
    : client;
}

// Callback and stream forms return no promise and pass through untimed; the
// ORM drivers only use the promise form.
function timeQuery(target: object) {
  return (...args: unknown[]): unknown => {
    const finish = beginDatabaseWait();
    const result = invoke(target, "query", args);
    if (isThenable(result)) {
      // The caller still receives the driver's own promise and rejection.
      void result.then(finish, finish);
    }
    return result;
  };
}

function timeConnect(target: object) {
  return (...args: unknown[]): unknown => {
    const finish = beginDatabaseWait();
    const result = invoke(target, "connect", args);
    if (!isThenable(result)) {
      return result;
    }
    return Promise.resolve(result).then(
      (client) => {
        finish();
        return wrapClient(client);
      },
      (error: unknown) => {
        finish();
        throw error;
      },
    );
  };
}

function timeTransaction(target: object) {
  return (callback: unknown, ...rest: unknown[]): unknown =>
    invoke(target, "transaction", [
      typeof callback === "function"
        ? (client: unknown) => callback(wrapClient(client))
        : callback,
      ...rest,
    ]);
}

/**
 * Time a database driver's calls into the request scope that issued them
 * (see `beginDatabaseWait`). Covers `query`, the client a pool's `connect`
 * hands to an ORM transaction, and the client PGlite passes to a
 * `transaction` callback. Acquiring a connection counts as waiting: on
 * Workers it is the request's connection handshake. Nothing about the
 * statement is retained.
 */
export function timeDatabaseClient<Client extends object>(
  client: Client,
): Client {
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") {
        return value;
      }
      if (property === "query") {
        return timeQuery(target);
      }
      if (property === "connect") {
        return timeConnect(target);
      }
      if (property === "transaction") {
        return timeTransaction(target);
      }
      return value.bind(target);
    },
  });
}
