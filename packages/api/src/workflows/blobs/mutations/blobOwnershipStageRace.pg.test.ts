import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import {
  attachmentBindings,
  blobStages,
  blobs,
} from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq, inArray } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
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
import type { PrevalidatedMultipartBlobStage } from "./types";

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

async function loadPrevalidatedStage(
  stageId: string,
): Promise<PrevalidatedMultipartBlobStage> {
  const [stage] = await db
    .select({
      byteLength: blobStages.byteLength,
      sha256: blobStages.sha256,
      stageId: blobStages.id,
      storageKey: blobStages.storageKey,
    })
    .from(blobStages)
    .where(eq(blobStages.id, stageId));
  if (!stage) {
    throw new Error("Expected staged blob fixture");
  }
  return stage;
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "concurrent foreign staged binds conceal the losing organization",
  async () => {
    const actors = [createTestUser(), createTestUser()] as const;
    for (const actor of actors) {
      await registerUser(actor);
      await authenticate(actor);
    }
    const blobId = crypto.randomUUID();
    const fixtures = await Promise.all(
      actors.map(async (owner) => {
        const root = await bootstrapRoot(owner);
        const document = await createDocument({ owner, root });
        const stagedBlob = await stageBlob(owner);
        return {
          bind: await buildBind({
            blobId,
            document,
            owner,
            root,
            stagedBlob,
          }),
          document,
          owner,
          prevalidatedStage: await loadPrevalidatedStage(stagedBlob.stageId),
          stageId: stagedBlob.stageId,
        };
      }),
    );
    const releases = fixtures.map(() => deferred());
    const reached = fixtures.map(() => deferred());
    let settledCount = 0;
    const binds = fixtures.map((fixture, index) =>
      runBindBlobAttachmentWorkflow(
        gateTransactionSelectAfterExecution({
          database: db,
          matchesSql: (sql) => sql.includes('from "blob_stages"'),
          occurrence: 1,
          reached: reached[index]?.resolve ?? (() => {}),
          release: releases[index]?.promise ?? Promise.resolve(),
        }),
        {
          blobId,
          fingerprint: fixture.owner.fingerprint,
          prevalidatedMultipartStage: fixture.prevalidatedStage,
          request: fixture.bind.request,
          sessionId: "blob-ownership-stage-race",
          userId: fixture.owner.userId,
        },
      ).then(
        () => {
          settledCount += 1;
          return {
            documentId: fixture.document.id,
            kind: "fulfilled" as const,
            stageId: fixture.stageId,
          };
        },
        (error: unknown) => {
          settledCount += 1;
          return {
            documentId: fixture.document.id,
            error,
            kind: "rejected" as const,
            stageId: fixture.stageId,
          };
        },
      ),
    );

    try {
      await Promise.all(reached.map((gate) => gate.promise));
      expect(settledCount).toBe(0);
      for (const release of releases) {
        release.resolve();
      }
      const results = await Promise.all(binds);
      const winners = results.filter((result) => result.kind === "fulfilled");
      const losers = results.filter((result) => result.kind === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const winner = winners[0];
      const loser = losers[0];
      if (!winner || !loser) {
        throw new Error("Expected one staged bind winner and one loser");
      }
      expect(loser).toMatchObject({
        error: { message: "Blob not found", status: 404 },
        kind: "rejected",
      });

      const bindingRows = await db
        .select({ documentId: attachmentBindings.documentId })
        .from(attachmentBindings)
        .where(eq(attachmentBindings.blobId, blobId));
      expect(bindingRows).toEqual([{ documentId: winner.documentId }]);
      const blobRows = await db
        .select({ id: blobs.id })
        .from(blobs)
        .where(eq(blobs.id, blobId));
      expect(blobRows).toEqual([{ id: blobId }]);
      const remainingStages = await db
        .select({ id: blobStages.id })
        .from(blobStages)
        .where(
          inArray(
            blobStages.id,
            fixtures.map((fixture) => fixture.stageId),
          ),
        );
      expect(remainingStages).toEqual([{ id: loser.stageId }]);
    } finally {
      for (const release of releases) {
        release.resolve();
      }
      await Promise.all(binds.map((bind) => bind.catch(() => undefined)));
    }
  },
  30_000,
);
