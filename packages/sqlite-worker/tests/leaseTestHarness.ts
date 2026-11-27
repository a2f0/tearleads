import {
  createDatabaseWorkerConnectionFactory,
  type DatabaseConnectionRegistryOptions,
} from "../src/databaseConnections";
import type { WorkerMethod, WorkerRequest, WorkerResponse } from "../src/types";
import {
  type DatabaseWorkerScope,
  registerDatabaseWorker,
} from "../src/workerCore";

/** One worker connection, as one tab's port would hold it. */
export class LeaseTestConnection implements DatabaseWorkerScope {
  private listener:
    | ((event: MessageEvent<WorkerRequest>) => void | Promise<void>)
    | undefined;
  private readonly messages: WorkerResponse[] = [];
  readonly notices: unknown[] = [];
  private nextId = 1;

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void | Promise<void>,
  ): void {
    if (type === "message") {
      this.listener = listener;
    }
  }

  postMessage(message: WorkerResponse): void {
    this.messages.push(message);
  }

  async send<K extends WorkerMethod>(
    method: K,
    params: WorkerRequest<K>["params"],
  ): Promise<WorkerResponse<K>["result"]> {
    const id = this.nextId;
    this.nextId += 1;
    await this.listener?.(
      new MessageEvent("message", {
        data: { id, method, params } as WorkerRequest<K>,
      }),
    );
    const response = this.messages.find((message) => message.id === id);
    if (!response) {
      throw new Error("Worker did not post a response.");
    }
    return response.result as WorkerResponse<K>["result"];
  }

  exec(sql: string): Promise<WorkerResponse<"exec">["result"]> {
    return this.send("exec", { rowMode: "array", sql });
  }

  /** Rows of a statement that must succeed. */
  async rows(sql: string): Promise<unknown[]> {
    const result = await this.exec(sql);
    if (!result.ok) {
      throw new Error(`${sql} failed: ${result.message}`);
    }
    return result.rows;
  }
}

export interface LeaseTestDatabase {
  readonly dbName: string;
  readonly logs: string[];
  readonly connect: () => Promise<LeaseTestConnection>;
  readonly init: (connection: LeaseTestConnection) => Promise<void>;
}

/**
 * A worker whose connections all open one fresh database with an `items`
 * table, as tabs sharing an owner worker do.
 */
export async function openLeaseTestDatabase(
  prefix: string,
  options: Omit<DatabaseConnectionRegistryOptions, "log"> = {},
): Promise<LeaseTestDatabase> {
  const logs: string[] = [];
  const createOptions = createDatabaseWorkerConnectionFactory({
    ...options,
    log: (message) => logs.push(message),
  });
  const dbName = `${prefix}-${crypto.randomUUID()}.db`;
  const init = async (connection: LeaseTestConnection) => {
    const result = await connection.send("init", {
      cipher: "sqlcipher",
      dbName,
      key: "secret",
    });
    if (!result.ok) {
      throw new Error(`init failed: ${result.message}`);
    }
  };
  const connect = async () => {
    const connection = new LeaseTestConnection();
    registerDatabaseWorker(
      connection,
      createOptions((notice) => connection.notices.push(notice)),
    );
    await init(connection);
    return connection;
  };

  const creator = await connect();
  await creator.rows("CREATE TABLE IF NOT EXISTS items (value INTEGER)");
  return { connect, dbName, init, logs };
}

/** Whether `promise` is still pending after `ms`. */
export async function stillPendingAfter(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  const pending = Symbol("pending");
  const winner = await Promise.race([
    promise.then(
      () => null,
      () => null,
    ),
    Bun.sleep(ms).then(() => pending),
  ]);
  return winner === pending;
}

export const OK_EMPTY = { ok: true, rows: [] } as const satisfies {
  ok: true;
  rows: [];
};
