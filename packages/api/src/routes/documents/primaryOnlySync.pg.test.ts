import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
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
import { createRouteApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");

pgTest(
  "primary-only sync ignores replica fences and returns no WAL checkpoint",
  async () => {
    const { DATABASE_URL: connectionString } = process.env;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const primary = createDefaultManagedApiDatabase(
      { API_DATABASE: "postgres", DATABASE_URL: connectionString },
      {
        readRouting: {
          connectionString,
          transport: "direct",
          readTarget: "primary",
          queryCache: "disabled",
        },
      },
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
      const { events, result } = await traceSyncQueries(
        primary.db,
        async (database) => {
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
              minLsn: "FFFFFFFF/FFFFFFFF",
              supportsPullPagination: true,
            }),
          });
        },
      );
      expect(result.status).toBe(200);
      const response = (await result.json()) as DocumentSyncResponse;
      expect(response).toMatchObject({
        commitLsn: "0/0",
        commitLsnMode: "untracked",
        acceptedOutgoingUpdateIds: [signed.updateId],
      });
      expect(events).toContainEqual({ kind: "committed" });
      expect(commitLsnEvents(events)).toEqual([]);
    } finally {
      await primary.close();
    }
  },
);
