import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  createDefaultManagedApiDatabase,
  databaseReadConsistency,
  databaseTransactionCompletion,
} from "./postgres";
import { createRequestScopedDatabaseRuntime } from "./requestScopedDatabase";

const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");

pgTest(
  "concurrent request scopes and their fallback cannot share primary eligibility",
  async () => {
    const { DATABASE_URL: connectionString } = process.env;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const env = { API_DATABASE: "postgres", DATABASE_URL: connectionString };
    const fallback = createDefaultManagedApiDatabase(env);
    const primary = createDefaultManagedApiDatabase(env, {
      readRouting: {
        connectionString,
        transport: "direct",
        readTarget: "primary",
        queryCache: "disabled",
      },
    });
    const tracked = createDefaultManagedApiDatabase(env);
    const pending = [primary, tracked];
    const closings: Promise<void>[] = [];
    const ready = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const runtime = createRequestScopedDatabaseRuntime({
      fallback,
      create: () => {
        const database = pending.shift();
        if (!database) throw new Error("Unexpected extra request");
        return database;
      },
    });
    try {
      const modes = await Promise.all(
        ready.map((entry) =>
          runtime.run(
            async () => {
              await runtime.db.execute(sql`select 1`);
              entry.resolve();
              await Promise.all(ready.map(({ promise }) => promise));
              return runtime.db.transaction(async (tx) => {
                const completion = databaseTransactionCompletion(tx);
                if (!completion)
                  throw new Error("Expected transaction completion");
                const mode = databaseReadConsistency(tx);
                expect(databaseReadConsistency(completion.root)).toBe(mode);
                expect(databaseReadConsistency(runtime.db)).toBe(mode);
                return mode;
              });
            },
            (closing) => {
              closings.push(closing);
            },
          ),
        ),
      );
      expect(modes).toEqual(["primary-only", "tracked"]);
      expect(databaseReadConsistency(runtime.db)).toBe("tracked");
      expect(runtime.current()).toBe(fallback);
    } finally {
      for (const entry of ready) entry.resolve();
      await Promise.all(closings);
      await fallback.close();
    }
  },
);
