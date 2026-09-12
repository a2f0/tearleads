import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  documents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { lockDocumentLifecycleInTransaction } from "../../workflows/documents/mutations/documentLifecycleLock";

for (const first of ["create", "delete"] as const) {
  test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
    `metadata ID creation and retirement serialize when ${first} starts first`,
    async () => {
      const owner = createTestUser();
      await registerUser(owner);
      await authenticate(owner);
      const root = await bootstrapRoot(owner);
      const child = await createChildContainer({ parent: root, signer: owner });
      const documentId = asVerifiedContainerManifest(child.accessManifest).state
        .metadataDocumentId;
      // A separately writable path does not lock the container being retired.
      // Only the stable metadata-ID lifecycle lock orders these transactions.
      const request = await createDocumentRequest({ owner, root, documentId });
      const operations = {
        create: () =>
          Promise.resolve(
            routeApp.request("/documents", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${owner.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(request),
            }),
          ),
        delete: () =>
          Promise.resolve(
            routeApp.request(`/containers/${child.containerId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${owner.token}` },
            }),
          ),
      };
      const lock = await holdPostgresLock((tx) =>
        lockDocumentLifecycleInTransaction(tx, documentId),
      );
      const contenders: Promise<Response>[] = [];
      let synchronizationError: unknown;
      try {
        contenders.push(operations[first]());
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          queryFragment: "pg_advisory_xact_lock",
        });
        contenders.push(operations[first === "create" ? "delete" : "create"]());
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          minimumWaiters: 2,
          queryFragment: "pg_advisory_xact_lock",
        });
      } catch (error) {
        synchronizationError = error;
      } finally {
        await lock.release();
      }
      const responses = await Promise.all(contenders);
      if (synchronizationError) throw synchronizationError;
      expect(responses.map((response) => response.status)).toEqual(
        first === "create" ? [409, 200] : [200, 409],
      );
      expect(await responses[first === "create" ? 0 : 1]?.json()).toEqual({
        error:
          first === "create"
            ? "Container metadata document must link only to its owning container"
            : "Document ID belongs to a deleted container",
      });
      expect(
        await db.select().from(documents).where(eq(documents.id, documentId)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(containerMetadataDocuments)
          .where(eq(containerMetadataDocuments.documentId, documentId)),
      ).toHaveLength(1);
    },
    30_000,
  );
}
