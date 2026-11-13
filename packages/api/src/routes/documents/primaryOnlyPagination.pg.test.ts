import { expect, test } from "bun:test";
import {
  type ApiDatabase,
  createDefaultManagedApiDatabase,
  db,
} from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES,
  parseWalLsn,
} from "@tearleads/validators/util";
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

async function post(
  database: ApiDatabase,
  token: string,
  id: string,
  request: DocumentSyncRequest,
) {
  return traceSyncQueries(database, async (observed) => {
    const app = createRouteApp({
      runtime: { ...getDefaultApiServiceRuntime(), db: observed },
    });
    const response = await app.request(`/documents/${id}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as DocumentSyncResponse;
  });
}

const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");
pgTest(
  "raw pagination retains its snapshot across primary/tracked mode switches",
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
      const created = await createDocument({ owner, root });
      const signed = await Promise.all(
        Array.from(
          { length: MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES + 1 },
          () => createSignedDocumentSyncRequest({ created, owner, root }),
        ),
      );
      const first = signed[0];
      const last = signed.at(-1);
      if (!first || !last) throw new Error("Expected signed history");
      await post(db, owner.token, created.id, {
        ...first.request,
        outgoingUpdates: signed
          .slice(0, -1)
          .flatMap(({ request }) => request.outgoingUpdates),
      });
      await post(db, owner.token, created.id, last.request);
      const request: DocumentSyncRequest = {
        ...first.request,
        authorizingContainerPathRefs: undefined,
        outgoingUpdates: [],
        historyMode: "raw",
        minLsn: "FFFFFFFF/FFFFFFFF",
        supportsPullPagination: true,
      };
      const page = await post(primary.db, owner.token, created.id, request);
      expect(page.result).toMatchObject({
        commitLsn: "0/0",
        commitLsnMode: "untracked",
      });
      expect(commitLsnEvents(page.events)).toEqual([]);
      if (page.result.commitLsn === null) throw new Error("Expected sentinel");
      const pullCursor = page.result.pullPage.nextCursor;
      if (!pullCursor) throw new Error("Expected a continuation");
      const late = await createSignedDocumentSyncRequest({
        created,
        owner,
        root,
      });
      await post(db, owner.token, created.id, late.request);
      const tail = await post(db, owner.token, created.id, {
        ...request,
        minLsn: page.result.commitLsn,
        pullCursor,
      });
      expect(tail.result.commitLsnMode).toBe("tracked");
      if (tail.result.commitLsn === null)
        throw new Error("Expected tracked LSN");
      expect(parseWalLsn(tail.result.commitLsn)).toBeGreaterThan(0n);
      expect(commitLsnEvents(tail.events).map(({ scope }) => scope)).toEqual([
        "transaction",
        "root",
      ]);
      expect(tail.result.pullPage.hasMore).toBe(false);
      const snapshot = [...page.result.updates, ...tail.result.updates].map(
        ({ id }) => id,
      );
      expect(new Set(snapshot)).toEqual(
        new Set(signed.map(({ updateId }) => updateId)),
      );
      expect(snapshot).not.toContain(late.updateId);
      const received: string[] = [];
      let cursor: string | undefined;
      do {
        const next = await post(primary.db, owner.token, created.id, {
          ...request,
          minLsn: tail.result.commitLsn,
          ...(cursor ? { pullCursor: cursor } : {}),
        });
        expect(next.result).toMatchObject({
          commitLsn: "0/0",
          commitLsnMode: "untracked",
        });
        expect(commitLsnEvents(next.events)).toEqual([]);
        received.push(...next.result.updates.map(({ id }) => id));
        cursor = next.result.pullPage.nextCursor ?? undefined;
      } while (cursor);
      expect(new Set(received)).toEqual(new Set([...snapshot, late.updateId]));
      expect(received.length).toBe(new Set(received).size);
    } finally {
      await primary.close();
    }
  },
  30_000,
);
