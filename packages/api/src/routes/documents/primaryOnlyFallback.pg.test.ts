import { expect, test } from "bun:test";
import {
  createDefaultManagedApiDatabase,
  db,
  type PostgresReadRouting,
} from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { parseWalLsn } from "@tearleads/validators/util";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  commitLsnEvents,
  traceSyncQueries,
} from "../../../test/helpers/syncQueryTrace";
import { readCurrentCommitLsn } from "../../documents/commitLsn";
import { createRouteApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");
pgTest.each(["absent", "unknown", "replica", "cached", "proxy"] as const)(
  "%s routing keeps real WAL fences and rolls back refused writes",
  async (mode) => {
    const { DATABASE_URL: connectionString } = process.env;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const readRouting: PostgresReadRouting = {
      connectionString,
      transport: mode === "proxy" ? "proxy" : "direct",
      readTarget:
        mode === "replica"
          ? "replica"
          : mode === "unknown"
            ? "unknown"
            : "primary",
      queryCache: mode === "cached" ? "enabled" : "disabled",
    };
    const managed = createDefaultManagedApiDatabase(
      { API_DATABASE: "postgres", DATABASE_URL: connectionString },
      mode === "absent" ? {} : { readRouting },
    );
    try {
      const owner = createTestUser();
      await registerUser(owner);
      await authenticate(owner);
      const root = await bootstrapRoot(owner);
      const document = await createDocument({ owner, root });
      const signed = await createSignedDocumentSyncRequest({
        owner,
        root,
        created: document,
      });
      const post = (minLsn: string) =>
        traceSyncQueries(managed.db, async (database) => {
          const app = createRouteApp({
            runtime: { ...getDefaultApiServiceRuntime(), db: database },
          });
          return app.request(`/documents/${document.id}/sync`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${owner.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ...signed.request,
              minLsn,
              supportsPullPagination: true,
            }),
          });
        });
      const rejected = await post("FFFFFFFF/FFFFFFFF");
      expect(rejected.result.status).toBe(503);
      expect(await rejected.result.json()).toEqual({
        error: "Requested minimum commit LSN has not been reached",
      });
      expect(
        commitLsnEvents(rejected.events).map(({ scope }) => scope),
      ).toEqual(["transaction"]);
      expect(rejected.events).toContainEqual({ kind: "rolledBack" });
      expect(
        await db
          .select({ id: documentUpdates.id })
          .from(documentUpdates)
          .where(eq(documentUpdates.documentId, document.id)),
      ).toEqual([]);
      const accepted = await post(await readCurrentCommitLsn(db));
      expect(accepted.result.status).toBe(200);
      const response = (await accepted.result.json()) as DocumentSyncResponse;
      expect(response.commitLsnMode).toBe("tracked");
      if (response.commitLsn === null)
        throw new Error("Expected tracked checkpoint");
      expect(parseWalLsn(response.commitLsn)).toBeGreaterThan(0n);
      expect(response.acceptedOutgoingUpdateIds).toEqual([signed.updateId]);
      expect(
        commitLsnEvents(accepted.events).map(({ scope }) => scope),
      ).toEqual(["transaction", "root"]);
    } finally {
      await managed.close();
    }
  },
);
