import { afterAll, expect, test } from "bun:test";
import {
  createDefaultManagedApiDatabase,
  getDefaultApiDatabaseKind,
} from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import {
  commitLsnEvents,
  traceSyncQueries,
} from "../../../test/helpers/syncQueryTrace";
import { documentCreateSeedResponse } from "../../workflows/documents/mutations/createDocument";

const { DATABASE_URL: databaseUrl } = process.env;
const primary =
  getDefaultApiDatabaseKind() === "postgres" && databaseUrl
    ? createDefaultManagedApiDatabase(
        { API_DATABASE: "postgres", DATABASE_URL: databaseUrl },
        {
          readRouting: {
            connectionString: databaseUrl,
            transport: "direct",
            readTarget: "primary",
            queryCache: "disabled",
          },
        },
      )
    : null;

afterAll(async () => {
  await primary?.close();
});

test.skipIf(primary === null)(
  "an explicitly primary-only seed checkpoint performs no WAL read",
  async () => {
    if (!primary) throw new Error("Expected a PostgreSQL fixture");
    await primary.db.execute(sql`select 1`);
    const { events, result } = await traceSyncQueries(primary.db, (db) =>
      documentCreateSeedResponse(db, {
        acceptedOutgoingUpdateIds: ["accepted"],
        insertedUpdateIds: ["accepted"],
      }),
    );
    expect(result).toEqual({
      acceptedOutgoingUpdateIds: ["accepted"],
      commitLsn: "0/0",
      commitLsnMode: "untracked",
    });
    expect(commitLsnEvents(events)).toEqual([]);
  },
);
