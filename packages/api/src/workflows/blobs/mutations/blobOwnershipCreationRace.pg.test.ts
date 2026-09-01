import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { attachmentBindings, blobs } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
import { gateTransactionSelectAfterExecution } from "../../../../test/helpers/gateDatabaseSelect";
import {
  bootstrapRoot,
  createDocument,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { runBindBlobAttachmentWorkflow } from "./bind";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function gateThirdBlobRead(input: {
  readonly reached: () => void;
  readonly release: Promise<void>;
}) {
  return gateTransactionSelectAfterExecution({
    database: db,
    matchesSql: (sql) => sql.includes('from "blobs"'),
    occurrence: 3,
    reached: input.reached,
    release: input.release,
  });
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a foreign creation after an absent ownership check stays concealed",
  async () => {
    const existingOwner = createTestUser();
    const racingOwner = createTestUser();
    await registerUser(existingOwner);
    await registerUser(racingOwner);
    await authenticate(existingOwner);
    await authenticate(racingOwner);

    const existingRoot = await bootstrapRoot(existingOwner);
    const existingDocument = await createDocument({
      owner: existingOwner,
      root: existingRoot,
    });
    const racingRoot = await bootstrapRoot(racingOwner);
    const racingDocument = await createDocument({
      owner: racingOwner,
      root: racingRoot,
    });
    const blobId = crypto.randomUUID();
    const existingBind = await buildBind({
      blobId,
      document: existingDocument,
      owner: existingOwner,
      root: existingRoot,
    });
    const racingBind = await buildBind({
      blobId,
      document: racingDocument,
      owner: racingOwner,
      root: racingRoot,
      stagedBlob: await stageBlob(racingOwner),
    });

    const thirdBlobReadReached = deferred();
    const releaseExistingBind = deferred();
    let existingBindSettled = false;
    const existingBindResult = runBindBlobAttachmentWorkflow(
      gateThirdBlobRead({
        reached: thirdBlobReadReached.resolve,
        release: releaseExistingBind.promise,
      }),
      {
        blobId,
        fingerprint: existingOwner.fingerprint,
        request: existingBind.request,
        sessionId: "blob-ownership-creation-race",
        userId: existingOwner.userId,
      },
    ).then(
      () => {
        existingBindSettled = true;
        return { kind: "fulfilled" as const };
      },
      (error: unknown) => {
        existingBindSettled = true;
        return { error, kind: "rejected" as const };
      },
    );

    try {
      await thirdBlobReadReached.promise;
      expect(existingBindSettled).toBe(false);
      await bindForTest({
        blobId,
        owner: racingOwner,
        request: racingBind.request,
      });
      releaseExistingBind.resolve();

      expect(await existingBindResult).toMatchObject({
        error: { message: "Blob not found", status: 404 },
        kind: "rejected",
      });
      const bindingRows = await db
        .select({ documentId: attachmentBindings.documentId })
        .from(attachmentBindings)
        .where(eq(attachmentBindings.blobId, blobId));
      expect(bindingRows).toEqual([{ documentId: racingDocument.id }]);
      const blobRows = await db
        .select({ id: blobs.id })
        .from(blobs)
        .where(eq(blobs.id, blobId));
      expect(blobRows).toEqual([{ id: blobId }]);
    } finally {
      releaseExistingBind.resolve();
      await existingBindResult.catch(() => undefined);
    }
  },
  30_000,
);
