import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
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
import { getDocumentContentKeyBundle } from "../../access/read/documentContentKeyStore";
import {
  listMissingDocumentUpdatePage,
  listMissingDocumentUpdates,
  readDocumentUpdateSequenceUpperBound,
} from "../../documents/documentUpdateStore";
import { runDocumentSyncWorkflow } from "../../workflows/documents/mutations/syncDocument";
import { listMissingSyncUpdatesForResponse } from "../../workflows/documents/mutations/syncPullResponse";

const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");
pgTest(
  "primary-only direct page and unpaged readers retain committed raw updates",
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
      const sync = await createSignedDocumentSyncRequest({
        owner,
        root,
        created: document,
      });
      await runDocumentSyncWorkflow(
        primary.db,
        {
          documentId: document.id,
          fingerprint: owner.fingerprint,
          userId: owner.userId,
          request: sync.request,
        },
        "primary-only-reader-test",
      );
      const contentKeyBundle = await getDocumentContentKeyBundle(
        document.id,
        document.contentKeyEpoch,
        primary.db,
      );
      if (!contentKeyBundle)
        throw new Error("Expected stored content-key bundle");
      const input = {
        documentId: document.id,
        localVersionVector: null,
        minLsn: "FFFFFFFF/FFFFFFFF",
      };
      const { events, result } = await traceSyncQueries(
        primary.db,
        async (database) => {
          const unpaged = await listMissingDocumentUpdates(database, input);
          const page = await listMissingDocumentUpdatePage(database, {
            ...input,
            afterSequence: 0,
            upperBoundSequence: await readDocumentUpdateSequenceUpperBound(
              database,
              document.id,
            ),
            maxUpdates: 64,
            maxSerializedBytes: 100_000,
          });
          const response = await listMissingSyncUpdatesForResponse({
            contentKeyBundle,
            documentId: document.id,
            executor: database,
            pullPagePlan: null,
            request: {
              ...sync.request,
              outgoingUpdates: [],
              minLsn: input.minLsn,
              historyMode: "raw",
            },
          });
          return { unpaged, page, response };
        },
      );
      expect(result.unpaged.map(({ id }) => id)).toEqual([sync.updateId]);
      expect(result.page.updates.map(({ id }) => id)).toEqual([sync.updateId]);
      expect(result.response.entries.map(({ update }) => update.id)).toEqual([
        sync.updateId,
      ]);
      expect(commitLsnEvents(events)).toEqual([]);
    } finally {
      await primary.close();
    }
  },
);
