import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { blobs } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import {
  bootstrapRoot,
  buildBindRequest,
  createDocumentFixture,
  registerOnly,
  runtime,
  stageEncryptedBlob,
} from "../../../test/helpers/blobMutationFixtures";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { bindBlobAttachment } from "./blobMutations";
import { getBlobBytes } from "./getBlob";

async function expectStagePromotesToObjectStore(input: {
  readonly owner: TestUser;
  readonly serviceRuntime: typeof runtime;
  readonly sha256: string;
  readonly stagedBlob: Awaited<ReturnType<typeof stageEncryptedBlob>>;
}) {
  const { owner } = input;
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });
  const blobId = input.stagedBlob.blobId;
  const bind = await buildBindRequest({
    blobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: input.stagedBlob,
  });

  await bindBlobAttachment(input.serviceRuntime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: bind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });

  const [storedBlob] = await db
    .select({
      storageKey: blobs.storageKey,
    })
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);
  expect(storedBlob?.storageKey).toBe(
    `organizations/${await getDefaultOrganizationId(owner.userId)}/blob-stages/${input.stagedBlob.stageId}`,
  );

  const blob = await getBlobBytes(input.serviceRuntime, {
    blobId,
    userId: owner.userId,
  });
  expect(blob.sha256).toBe(input.sha256);
  const bytes = new Uint8Array(
    await new Response(blob.encryptedBytes).arrayBuffer(),
  );
  expect(bytes).toEqual(input.stagedBlob.bytes);
}

test("bind promotes multipart stages without inline bytes", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const blobId = crypto.randomUUID();
  const multipartStage = await stageEncryptedBlob({
    blobId,
    owner,
  });

  await expectStagePromotesToObjectStore({
    owner,
    serviceRuntime: runtime,
    sha256: multipartStage.sha256,
    stagedBlob: multipartStage,
  });
});

test("bindBlobAttachment prevalidates multipart object bytes before opening the transaction", async () => {
  const owner = createTestUser();
  await registerOnly(owner);
  const container = await bootstrapRoot(owner);
  const document = await createDocumentFixture({ container, owner });
  const baseRuntime = createServiceTestRuntime();
  let transactionDepth = 0;
  let readObjectOutsideTransaction = false;
  const trackingDb = new Proxy(baseRuntime.db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "transaction" || typeof value !== "function") {
        return value;
      }

      return async (...args: unknown[]) => {
        transactionDepth += 1;
        try {
          return await Reflect.apply(value, target, args);
        } finally {
          transactionDepth -= 1;
        }
      };
    },
  }) as typeof baseRuntime.db;
  const trackingRuntime: typeof baseRuntime = {
    ...baseRuntime,
    blobObjectStore: {
      ...baseRuntime.blobObjectStore,
      // A first bind's one object read is the completion's readback.
      completeMultipartUpload: async (input) => {
        expect(transactionDepth).toBe(0);
        readObjectOutsideTransaction = true;
        return baseRuntime.blobObjectStore.completeMultipartUpload(input);
      },
    },
    db: trackingDb,
  };
  const blobId = crypto.randomUUID();
  const multipartStage = await stageEncryptedBlob(
    {
      blobId,
      owner,
    },
    trackingRuntime,
  );
  const bind = await buildBindRequest({
    blobId,
    container,
    document,
    expectedBindingId: null,
    owner,
    slotId: "preview",
    stagedBlob: multipartStage,
  });

  await bindBlobAttachment(trackingRuntime, {
    blobId,
    fingerprint: owner.fingerprint,
    request: bind.request,
    sessionId: "test-session",
    userId: owner.userId,
  });

  expect(readObjectOutsideTransaction).toBe(true);
});
