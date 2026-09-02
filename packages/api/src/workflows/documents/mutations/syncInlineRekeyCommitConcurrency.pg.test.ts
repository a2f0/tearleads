import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../../test/helpers/postgresConcurrency";
import { reserveInlineRekeyCommit } from "./syncInlineRekeyCommit";

const concurrencyTimeoutMs = 30_000;

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "concurrent inline rekey retries serialize on their commit reservation",
  async () => {
    const documentId = crypto.randomUUID();
    await db.insert(documents).values({
      createdByFingerprint: "inline-rekey-concurrency-test",
      id: documentId,
    });
    const request = {
      containerRekeys: [{}],
      inlineRekeyCommitId: "d".repeat(64),
      outgoingUpdates: [{ id: crypto.randomUUID() }],
    } as unknown as DocumentSyncRequest;
    const holder = await holdPostgresLock((executor) =>
      reserveInlineRekeyCommit({ documentId, executor, request }),
    );
    let contenderSettled = false;
    const contender = db
      .transaction((executor) =>
        reserveInlineRekeyCommit({ documentId, executor, request }),
      )
      .then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        contenderSettled = true;
      });

    try {
      await waitForPostgresLockWait({
        blockerPid: holder.backendPid,
        queryFragment: "document_inline_rekey_commits",
      });
      expect(contenderSettled).toBe(false);
    } finally {
      await holder.release();
    }

    expect((await contender).error).toMatchObject({
      code: DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
      status: 409,
    });
  },
  concurrencyTimeoutMs,
);
