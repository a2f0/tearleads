import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { withDatabaseStatementCounter } from "./databaseStatementCounter";
import { timeDatabaseClient } from "./databaseWaitTiming";
import { createDefaultManagedApiDatabase } from "./postgres";

const databaseUrlKey = "DATABASE_URL";
const postgresUrl = process.env[databaseUrlKey];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeClient {
  readonly released: string[] = [];
  constructor(readonly name: string) {}

  async query(text: string): Promise<string> {
    await delay(15);
    return `${this.name}:${text}`;
  }

  release(): void {
    this.released.push(this.name);
  }
}

class FakePool {
  readonly client = new FakeClient("pooled");

  async query(text: string): Promise<string> {
    await delay(15);
    return text;
  }

  async connect(): Promise<FakeClient> {
    await delay(15);
    return this.client;
  }

  async transaction<T>(callback: (client: FakeClient) => Promise<T>) {
    return callback(new FakeClient("transaction"));
  }
}

describe("timeDatabaseClient", () => {
  test("charges query time to initialized counters only", async () => {
    const pool = timeDatabaseClient(new FakePool());
    const outer = { statements: 0, waitMs: 0 };
    const uninitialized = { statements: 0 };

    const result = await withDatabaseStatementCounter(outer, () =>
      withDatabaseStatementCounter(uninitialized, () => pool.query("select")),
    );

    expect(result).toBe("select");
    expect(outer.waitMs).toBeGreaterThanOrEqual(10);
    expect(uninitialized).toEqual({ statements: 0 });
  });

  test("charges the scope that issued a call, not the one that settles it", async () => {
    const issued = Promise.withResolvers<string>();
    const client = timeDatabaseClient({ query: () => issued.promise });
    const issuer = { statements: 0, waitMs: 0 };
    const settler = { statements: 0, waitMs: 0 };

    const pending = withDatabaseStatementCounter(issuer, () => client.query());
    await withDatabaseStatementCounter(settler, async () => {
      await delay(15);
      issued.resolve("done");
    });

    expect(await pending).toBe("done");
    expect(issuer.waitMs).toBeGreaterThanOrEqual(10);
    expect(settler.waitMs).toBe(0);
  });

  test("times connection acquisition and the connected client", async () => {
    const pool = timeDatabaseClient(new FakePool());
    const counter = { statements: 0, waitMs: 0 };

    await withDatabaseStatementCounter(counter, async () => {
      const client = await pool.connect();
      const afterConnect = counter.waitMs;
      expect(afterConnect).toBeGreaterThanOrEqual(10);
      expect(await client.query("begin")).toBe("pooled:begin");
      expect(counter.waitMs).toBeGreaterThanOrEqual(afterConnect + 10);
      client.release();
    });

    expect(pool.client.released).toEqual(["pooled"]);
  });

  test("times queries on the client a transaction callback receives", async () => {
    const pool = timeDatabaseClient(new FakePool());
    const counter = { statements: 0, waitMs: 0 };

    const result = await withDatabaseStatementCounter(counter, () =>
      pool.transaction((client) => client.query("select")),
    );

    expect(result).toBe("transaction:select");
    expect(counter.waitMs).toBeGreaterThanOrEqual(10);
  });

  test("keeps the driver's rejection and records the failed call", async () => {
    const failure = new Error("connection reset");
    const client = timeDatabaseClient({
      query: async () => {
        await delay(15);
        throw failure;
      },
    });
    const counter = { statements: 0, waitMs: 0 };

    const pending = withDatabaseStatementCounter(counter, () => client.query());

    await expect(pending).rejects.toBe(failure);
    expect(counter.waitMs).toBeGreaterThanOrEqual(10);
  });

  test("passes callback-form calls through untimed", () => {
    const callbacks: Array<(error: null, rows: string) => void> = [];
    const client = timeDatabaseClient({
      query: (_text: string, callback: (error: null, rows: string) => void) => {
        callbacks.push(callback);
        return undefined;
      },
    });
    const counter = { statements: 0, waitMs: 0 };

    const returned = withDatabaseStatementCounter(counter, () =>
      client.query("select", () => {}),
    );

    expect(returned).toBeUndefined();
    expect(callbacks).toHaveLength(1);
    expect(counter.waitMs).toBe(0);
  });

  test("does nothing outside a counter scope", async () => {
    const pool = timeDatabaseClient(new FakePool());
    expect(await pool.query("select")).toBe("select");
  });
});

const backends = [
  { API_DATABASE: "memory" },
  ...(postgresUrl
    ? [{ API_DATABASE: "postgres", DATABASE_URL: postgresUrl }]
    : []),
];

for (const environment of backends) {
  test(`${environment.API_DATABASE} accumulates driver wait for queries and transactions`, async () => {
    const managed = createDefaultManagedApiDatabase(environment);
    const outer = { statements: 0, waitMs: 0 };
    const inner = { statements: 0, waitMs: 0 };
    const heavy = sql`select count(*) from generate_series(1, 20000)`;
    try {
      await withDatabaseStatementCounter(outer, async () => {
        await managed.db.execute(heavy);
        await withDatabaseStatementCounter(inner, () =>
          managed.db.transaction(async (tx) => {
            await tx.execute(heavy);
          }),
        );
      });
      expect(inner.waitMs).toBeGreaterThan(0);
      expect(outer.waitMs).toBeGreaterThan(inner.waitMs);
      const settled = outer.waitMs;
      await managed.db.execute(heavy);
      expect(outer.waitMs).toBe(settled);
    } finally {
      await managed.close();
    }
  });
}
