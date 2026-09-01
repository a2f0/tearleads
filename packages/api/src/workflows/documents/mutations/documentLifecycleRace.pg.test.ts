import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import { buildDocumentPurgeRequest } from "../../../../test/helpers/documentPurge";
import {
  bootstrapRoot,
  createDocumentRequest,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../../test/helpers/registerUser";
import { runCreateDocumentWorkflow } from "./createDocument";
import { lockDocumentLifecycleInTransaction } from "./documentLifecycleLock";
import { runPurgeDocumentWorkflow } from "./purgeDocument";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "purge and replayed create serialize on the terminal document identity",
  async () => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const root = await bootstrapRoot(owner);
    const createRequest = await createDocumentRequest({ owner, root });
    const created = await runCreateDocumentWorkflow(db, {
      fingerprint: owner.fingerprint,
      request: createRequest,
      userId: owner.userId,
    });
    const purgeRequest = await buildDocumentPurgeRequest({
      documentId: created.id,
      documentManifestHash: created.accessManifest.manifestHash,
      owner,
      root,
    });
    const blocker = await holdPostgresLock((tx) =>
      lockDocumentLifecycleInTransaction(tx, created.id),
    );

    let replaySettled = false;
    const purge = runPurgeDocumentWorkflow(db, {
      documentId: created.id,
      fingerprint: owner.fingerprint,
      request: purgeRequest,
      userId: owner.userId,
    });
    let replay:
      | Promise<
          | { readonly kind: "fulfilled" }
          | { readonly error: unknown; readonly kind: "rejected" }
        >
      | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: blocker.backendPid,
        queryFragment: "pg_advisory_xact_lock",
      });
      replay = runCreateDocumentWorkflow(db, {
        fingerprint: owner.fingerprint,
        request: createRequest,
        userId: owner.userId,
      }).then(
        () => {
          replaySettled = true;
          return { kind: "fulfilled" as const };
        },
        (error: unknown) => {
          replaySettled = true;
          return { error, kind: "rejected" as const };
        },
      );
      await waitForPostgresLockWait({
        blockerPid: blocker.backendPid,
        minimumWaiters: 2,
        queryFragment: "pg_advisory_xact_lock",
      });
      expect(replaySettled).toBe(false);
    } catch (error) {
      synchronizationError = error;
    } finally {
      await blocker.release();
    }

    const purgeResult = await purge;
    const replayResult = await (replay ?? Promise.reject(synchronizationError));
    if (synchronizationError) throw synchronizationError;

    expect(purgeResult.response.documentId).toBe(created.id);
    expect(replayResult).toMatchObject({
      error: {
        message: "Document was permanently purged",
        status: 409,
      },
      kind: "rejected",
    });
    await expect(
      db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, created.id)),
    ).resolves.toEqual([]);
  },
  30_000,
);
