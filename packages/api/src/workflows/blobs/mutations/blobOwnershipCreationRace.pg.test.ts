import { expect, test } from "bun:test";
import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import { db, getDefaultApiDatabaseKind } from "@symcrypt/api-shared/postgres";
import { attachmentBindings, blobs } from "@symcrypt/api-shared/schema";
import { createTestUser } from "@symcrypt/bob-and-alice";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  bindForTest,
  buildBind,
  stageBlob,
} from "../../../../test/helpers/blobAttachmentKit";
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

function gateSelectBuilder<T extends object>(
  builder: T,
  afterExecution: (query: T) => Promise<void>,
  proxies = new WeakMap<object, object>(),
): T {
  const existing = proxies.get(builder);
  if (existing) {
    return existing as T;
  }
  const proxy = new Proxy(builder, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, target);
      if (property === "then" && typeof value === "function") {
        return (
          onFulfilled: (result: unknown) => unknown,
          onRejected: (error: unknown) => unknown,
        ) =>
          value.call(
            target,
            async (result: unknown) => {
              await afterExecution(target);
              return onFulfilled(result);
            },
            onRejected,
          );
      }
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (
          result !== null &&
          typeof result === "object" &&
          typeof Reflect.get(result, "then", result) === "function"
        ) {
          return gateSelectBuilder(result, afterExecution, proxies);
        }
        return result === target ? receiver : result;
      };
    },
  });
  proxies.set(builder, proxy);
  return proxy;
}

function gateThirdBlobRead(input: {
  readonly reached: () => void;
  readonly release: Promise<void>;
}): ApiDatabase {
  return new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "transaction" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (callback: (tx: DatabaseTransaction) => Promise<unknown>) =>
        value.call(target, (tx: DatabaseTransaction) => {
          let blobReadCount = 0;
          const gatedTx = new Proxy(tx, {
            get(transaction, txProperty) {
              const txValue = Reflect.get(transaction, txProperty, transaction);
              if (txProperty !== "select" || typeof txValue !== "function") {
                return typeof txValue === "function"
                  ? txValue.bind(transaction)
                  : txValue;
              }
              return (...args: unknown[]) =>
                gateSelectBuilder(
                  txValue.apply(transaction, args) as object,
                  async (query) => {
                    const toSql = Reflect.get(query, "toSQL", query);
                    if (
                      typeof toSql !== "function" ||
                      !String(toSql.call(query).sql).includes('from "blobs"')
                    ) {
                      return;
                    }
                    blobReadCount += 1;
                    if (blobReadCount === 3) {
                      input.reached();
                      await input.release;
                    }
                  },
                );
            },
          }) as DatabaseTransaction;
          return callback(gatedTx);
        });
    },
  }) as ApiDatabase;
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
