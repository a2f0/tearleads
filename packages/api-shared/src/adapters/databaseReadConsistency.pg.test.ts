import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { postgresReadConsistency } from "./databaseReadConsistency";
import {
  createDefaultManagedApiDatabase,
  databaseReadConsistency,
  type PostgresReadRouting,
} from "./postgres";

const { DATABASE_URL: databaseUrl } = process.env;
const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");

pgTest(
  "transactions and savepoints retain their own database's consistency",
  async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const env = { API_DATABASE: "postgres", DATABASE_URL: databaseUrl };
    const primary = createDefaultManagedApiDatabase(env, {
      readRouting: routing(databaseUrl),
    });
    const tracked = createDefaultManagedApiDatabase(env);
    try {
      await primary.db.transaction(async (tx) => {
        expect(databaseReadConsistency(tx)).toBe("primary-only");
        await tx.transaction(async (nested) => {
          expect(databaseReadConsistency(nested)).toBe("primary-only");
          await tracked.db.transaction(async (other) => {
            expect(databaseReadConsistency(other)).toBe("tracked");
          });
          expect(databaseReadConsistency(nested)).toBe("primary-only");
        });
      });
      expect(databaseReadConsistency(tracked.db)).toBe("tracked");
    } finally {
      await primary.close();
      await tracked.close();
    }
  },
);

function routing(connectionString: string): PostgresReadRouting {
  return {
    connectionString,
    transport: "direct",
    readTarget: "primary",
    queryCache: "disabled",
  };
}

test.each([
  "postgresql://owner@localhost/example",
  "postgresql://localhost:5432/example",
  "postgresql://owner@:5432/example",
  "postgresql://owner@localhost:5432/",
  "not-a-url",
  "https://owner@localhost:5432/example",
  "postgresql://owner@localhost:5432/example?host=",
  "postgresql://owner@localhost:5432/example?port=",
  "postgresql://owner@localhost:5432/example?user=",
  "postgresql://owner@localhost:5432/example?database=",
])("unsupported endpoint %s stays tracked", (connectionString) => {
  const policy = postgresReadConsistency(
    { connectionString },
    routing(connectionString),
  );
  expect(policy.verify).toBeUndefined();
  expect(policy.read()).toBe("tracked");
});

pgTest(
  "primary-only eligibility waits for a real writable primary connection",
  async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const database = createDefaultManagedApiDatabase(
      { API_DATABASE: "postgres", DATABASE_URL: databaseUrl },
      { readRouting: routing(databaseUrl) },
    );
    try {
      expect(databaseReadConsistency(database.db)).toBe("tracked");
      await database.db.execute(sql`select 1`);
      expect(databaseReadConsistency(database.db)).toBe("primary-only");
    } finally {
      await database.close();
    }
  },
);

pgTest(
  "a claimed primary route cannot hand out a read-only connection",
  async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const readOnlyUrl = new URL(databaseUrl);
    readOnlyUrl.searchParams.set(
      "options",
      "-c default_transaction_read_only=on",
    );
    const connectionString = readOnlyUrl.toString();
    const database = createDefaultManagedApiDatabase(
      { API_DATABASE: "postgres", DATABASE_URL: connectionString },
      { readRouting: routing(connectionString) },
    );
    try {
      const result = await Promise.resolve(database.db.execute(sql`select 1`))
        .then(() => null)
        .catch((error: unknown) => error);
      expect(result).toBeInstanceOf(Error);
      expect(databaseReadConsistency(database.db)).toBe("tracked");
    } finally {
      await database.close();
    }
  },
);

pgTest(
  "unproved, replica, cached, proxy and mismatched routing stay tracked",
  async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const primary = routing(databaseUrl);
    const configurations: (PostgresReadRouting | undefined)[] = [
      undefined,
      { ...primary, readTarget: "unknown" },
      { ...primary, readTarget: "replica" },
      { ...primary, queryCache: "unknown" },
      { ...primary, queryCache: "enabled" },
      { ...primary, transport: "unknown" },
      { ...primary, transport: "proxy" },
      { ...primary, connectionString: `${databaseUrl}?application_name=other` },
    ];
    for (const readRouting of configurations) {
      const database = createDefaultManagedApiDatabase(
        { API_DATABASE: "postgres", DATABASE_URL: databaseUrl },
        readRouting === undefined ? {} : { readRouting },
      );
      try {
        await database.db.execute(sql`select 1`);
        expect(databaseReadConsistency(database.db)).toBe("tracked");
      } finally {
        await database.close();
      }
    }
  },
);

pgTest(
  "an incomplete endpoint cannot borrow ambient connection routing",
  async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const incomplete = new URL(databaseUrl);
    incomplete.port = "";
    const connectionString = incomplete.toString();
    const database = createDefaultManagedApiDatabase(
      { API_DATABASE: "postgres", DATABASE_URL: connectionString },
      { readRouting: routing(connectionString) },
    );
    try {
      await database.db.execute(sql`select 1`);
      expect(databaseReadConsistency(database.db)).toBe("tracked");
    } finally {
      await database.close();
    }
  },
);

test("a custom transport cannot claim native primary-only eligibility", () => {
  const connectionString = "postgresql://owner@localhost:5432/example";
  const policy = postgresReadConsistency(
    { connectionString, stream: () => undefined },
    routing(connectionString),
  );
  expect(policy.verify).toBeUndefined();
  expect(policy.read()).toBe("tracked");
});

test("a memory database does not inherit a PostgreSQL routing contract", async () => {
  const database = createDefaultManagedApiDatabase(
    { API_DATABASE: "memory" },
    { readRouting: routing("postgres://localhost/unused") },
  );
  try {
    expect(databaseReadConsistency(database.db)).toBe("tracked");
  } finally {
    await database.close();
  }
});
