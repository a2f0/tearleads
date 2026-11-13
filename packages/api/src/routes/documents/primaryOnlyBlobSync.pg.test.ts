import { expect, test } from "bun:test";
import { createDefaultManagedApiDatabase } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  blobAttachmentTestRuntime,
  buildBind,
  stageBlob,
} from "../../../test/helpers/blobAttachmentKit";
import { createFirstUpdateSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  commitLsnEvents,
  traceSyncQueries,
} from "../../../test/helpers/syncQueryTrace";
import { bindBlobAttachment } from "../../services/blobs/blobMutations";

const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");

pgTest(
  "primary-only blob carried sync returns the exact untracked checkpoint",
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
      const input = { owner, root, document };
      const blobId = crypto.randomUUID();
      const { request } = await buildBind({
        ...input,
        blobId,
        stagedBlob: await stageBlob(owner, blobId),
      });
      const sync = await createFirstUpdateSyncRequest(input);
      const { events, result } = await traceSyncQueries(
        primary.db,
        (database) =>
          bindBlobAttachment(
            { ...blobAttachmentTestRuntime, db: database },
            {
              blobId,
              fingerprint: owner.fingerprint,
              userId: owner.userId,
              sessionId: "primary-only-sync-test",
              request: {
                ...request,
                documentSync: { ...sync.request, minLsn: "FFFFFFFF/FFFFFFFF" },
              },
            },
          ),
      );
      expect(result.documentSync).toEqual({
        acceptedOutgoingUpdateIds: [sync.id],
        commitLsn: "0/0",
        commitLsnMode: "untracked",
      });
      expect(commitLsnEvents(events)).toEqual([]);
      expect(events).toContainEqual({ kind: "committed" });
    } finally {
      await primary.close();
    }
  },
);
