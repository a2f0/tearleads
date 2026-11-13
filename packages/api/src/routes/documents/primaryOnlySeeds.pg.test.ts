import { expect, test } from "bun:test";
import {
  type ApiDatabase,
  createDefaultManagedApiDatabase,
  db,
} from "@tearleads/api-shared/postgres";
import { documentUpdates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildMetadataDocumentCreateRequest } from "../../../test/helpers/containerCreateRequests";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import type { CreatedDocumentFixture } from "../../../test/helpers/documentAcknowledgementFixture";
import { createFirstUpdateSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  commitLsnEvents,
  traceSyncQueries,
} from "../../../test/helpers/syncQueryTrace";
import { runCreateContainerWithMetadataDocumentWorkflow } from "../../workflows/containers/mutations/createContainerWithMetadataDocument";
import { runCreateDocumentWorkflow } from "../../workflows/documents/mutations/createDocument";

function holdCommit(database: ApiDatabase) {
  const entered = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const transaction: ApiDatabase["transaction"] = (callback, config) =>
    database.transaction(async (tx) => {
      const result = await callback(tx);
      entered.resolve();
      await released.promise;
      return result;
    }, config);
  return {
    beforeCommit: entered.promise,
    release: () => released.resolve(),
    database: new Proxy(database, {
      get(target, property, receiver) {
        return property === "transaction"
          ? transaction
          : Reflect.get(target, property, receiver);
      },
    }),
  };
}

async function seedPlan(kind: "document" | "metadata") {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const container = await buildChildCreateRequest({ root, signer: owner });
  const request =
    kind === "document"
      ? await createDocumentRequest({ owner, root })
      : await buildMetadataDocumentCreateRequest({
          containerId: String(Reflect.get(container.event, "objectId")),
          containerRequest: container,
          parent: root.bundle,
          signer: owner,
        });
  const document = {
    accessManifest: { state: request.manifest },
    contentKeyBundle: request.contentKeyBundle,
    id: String(Reflect.get(request.manifest, "objectId")),
  } as unknown as CreatedDocumentFixture;
  const sync = await createFirstUpdateSyncRequest({
    owner,
    root,
    document,
    authorizingContainerPathRefs: request.targetContainerPathRefs
      ? [request.targetContainerPathRefs]
      : undefined,
  });
  const seed = { ...sync.request, minLsn: "FFFFFFFF/FFFFFFFF" };
  return {
    documentId: document.id,
    updateId: sync.id,
    run: async (database: ApiDatabase) => {
      const identity = { fingerprint: owner.fingerprint, userId: owner.userId };
      if (kind === "document") {
        const result = await runCreateDocumentWorkflow(database, {
          ...identity,
          request: { ...request, initialSync: seed },
        });
        return result.response.initialSync;
      }
      const result = await runCreateContainerWithMetadataDocumentWorkflow(
        database,
        {
          ...identity,
          request: {
            container,
            metadataDocument: request,
            initialMetadataSync: seed,
          },
        },
      );
      return result.response.metadataDocument.initialSync;
    },
  };
}

const { API_DATABASE } = process.env;
const pgTest = test.skipIf(API_DATABASE !== "postgres");
pgTest.each(["document", "metadata"] as const)(
  "primary-only %s seed acknowledges only after real commit",
  async (kind) => {
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
      const plan = await seedPlan(kind);
      const stored = () =>
        db
          .select({ id: documentUpdates.id })
          .from(documentUpdates)
          .where(eq(documentUpdates.documentId, plan.documentId));
      const { events, result } = await traceSyncQueries(
        primary.db,
        async (database) => {
          const held = holdCommit(database);
          let settled = false;
          const pending = plan.run(held.database).finally(() => {
            settled = true;
          });
          try {
            await Promise.race([
              held.beforeCommit,
              pending.then(() => {
                throw new Error("Workflow returned before the commit barrier");
              }),
            ]);
            expect(settled).toBe(false);
            expect(await stored()).toEqual([]);
            expect(settled).toBe(false);
          } finally {
            held.release();
            await pending.catch(() => {});
          }
          return pending;
        },
      );
      expect(result).toEqual({
        acceptedOutgoingUpdateIds: [plan.updateId],
        commitLsn: "0/0",
        commitLsnMode: "untracked",
      });
      expect(await stored()).toEqual([{ id: plan.updateId }]);
      expect(commitLsnEvents(events)).toEqual([]);
      expect(events).toContainEqual({ kind: "committed" });
    } finally {
      await primary.close();
    }
  },
);
