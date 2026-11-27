import { expect, test } from "bun:test";
import { createDatabaseWorkerClient } from "../src/client";
import {
  createModuleDatabaseRuntime,
  isDatabaseConnectionLostError,
} from "../src/runtime";
import { DATABASE_TRANSACTION_REVOKED_MESSAGE } from "../src/types";
import { DatabaseTransactionRevokedError } from "../src/workerCrash";

const REVOKED = `${DATABASE_TRANSACTION_REVOKED_MESSAGE} (database a.db, idle 3000 ms, 1 statement(s) waiting)`;

type Request = { id: number; method: string };

// A SharedWorker port whose worker revoked this connection's transaction: it
// answers every statement with the revocation, and anything else with success.
class RevokingPort extends EventTarget {
  start() {}
  close() {}

  postMessage(message: Request) {
    const result =
      message.method === "exec"
        ? { ok: false, message: REVOKED }
        : { ok: true, rows: [] };
    queueMicrotask(() => {
      this.dispatchEvent(
        new MessageEvent("message", { data: { id: message.id, result } }),
      );
    });
  }
}

class RevokingSharedWorker extends EventTarget {
  readonly port = new RevokingPort();
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

test("a revoked statement rejects as a lost connection on any worker client", async () => {
  const client = createDatabaseWorkerClient(new RevokingPort());

  const error = await rejection(client.exec({ sql: "COMMIT" }));

  expect(error).toBeInstanceOf(DatabaseTransactionRevokedError);
  expect(isDatabaseConnectionLostError(error)).toBe(true);
  expect(String(error)).toContain(REVOKED);
  client.destroy();
});

test("a shared worker's revocation fails the client's requests and tells the host once per open", async () => {
  const runtime = createModuleDatabaseRuntime({
    sharedWorkerConstructor: RevokingSharedWorker,
  });
  const crashes: Error[] = [];
  runtime.subscribeWorkerError?.((error) => crashes.push(error));

  const first = rejection(runtime.client.exec({ sql: "INSERT 1" }));
  const second = rejection(runtime.client.exec({ sql: "INSERT 2" }));
  for (const error of await Promise.all([first, second])) {
    expect(error).toBeInstanceOf(DatabaseTransactionRevokedError);
  }
  expect(crashes).toHaveLength(1);
  expect(crashes[0]).toBeInstanceOf(DatabaseTransactionRevokedError);

  // A statement sent before the host reopens is refused without a second
  // announcement; the next open's revocation is announced again.
  expect(
    await rejection(runtime.client.exec({ sql: "SELECT 1" })),
  ).toBeInstanceOf(DatabaseTransactionRevokedError);
  expect(crashes).toHaveLength(1);
  await runtime.client.init({ cipher: "sqlcipher", dbName: "a.db", key: "k" });
  await rejection(runtime.client.exec({ sql: "SELECT 1" }));
  expect(crashes).toHaveLength(2);

  runtime.terminateNow();
});
