import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobStages, organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { declaredFirstPart } from "../../../test/helpers/blobStageParts";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { probeTransactions } from "../../../test/helpers/transactionProgress";
import { initiateMultipartBlobStage } from "./multipartStage";

const postgresTest = test.skipIf(getDefaultApiDatabaseKind() !== "postgres");
const metadata = {
  byteLength: 1,
  firstParts: declaredFirstPart(1),
  sha256: "encrypted-sha256",
};

function stages(organizationId: string) {
  return db
    .select()
    .from(blobStages)
    .where(eq(blobStages.organizationId, organizationId));
}

postgresTest(
  "staging refuses a foreign member before creating an upload",
  async () => {
    const owner = await createBlobStageOwner();
    const foreign = await createBlobStageOwner();
    const runtime = createServiceTestRuntime();
    const store = runtime.blobObjectStore;
    let uploads = 0;
    runtime.blobObjectStore = {
      ...store,
      createMultipartUpload: async (input) => {
        uploads += 1;
        return store.createMultipartUpload(input);
      },
    };
    await expect(
      initiateMultipartBlobStage(runtime, {
        ...owner,
        ...metadata,
        userId: foreign.userId,
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "Organization access denied",
    });
    expect(uploads).toBe(0);
    expect(await stages(owner.organizationId)).toEqual([]);
  },
);

for (const abortFails of [false, true]) {
  postgresTest(
    `staging rechecks endpoint availability after upload I/O (abort fails: ${abortFails})`,
    async () => {
      const owner = await createBlobStageOwner();
      const runtime = createServiceTestRuntime();
      const store = runtime.blobObjectStore;
      let uploads = 0;
      let aborts = 0;
      runtime.blobObjectStore = {
        ...store,
        createMultipartUpload: async (input) => {
          const upload = await store.createMultipartUpload(input);
          uploads += 1;
          await db
            .update(organizationBilling)
            .set({ status: "deleting" })
            .where(
              eq(organizationBilling.organizationId, owner.organizationId),
            );
          return upload;
        },
        abortMultipartUpload: async (input) => {
          aborts += 1;
          if (abortFails) throw new Error("abort unavailable");
          return store.abortMultipartUpload(input);
        },
      };
      await expect(
        initiateMultipartBlobStage(runtime, { ...owner, ...metadata }),
      ).rejects.toMatchObject({
        status: 409,
        message: "Organization is being purged",
      });
      expect(uploads).toBe(1);
      expect(aborts).toBe(1);
      expect(await stages(owner.organizationId)).toEqual([]);
    },
  );

  postgresTest(
    `staging rolls back a completed insert and preserves its error (abort fails: ${abortFails})`,
    async () => {
      const owner = await createBlobStageOwner();
      const failure = new Error("failure after real stage insert");
      let inserts = 0;
      const observed = probeTransactions(db, {
        after: async (query) => {
          if (query.startsWith('insert into "blob_stages"')) {
            inserts += 1;
            throw failure;
          }
        },
      });
      const runtime = createServiceTestRuntime(observed.database);
      const store = runtime.blobObjectStore;
      let aborts = 0;
      runtime.blobObjectStore = {
        ...store,
        abortMultipartUpload: async (input) => {
          aborts += 1;
          if (abortFails) throw new Error("abort unavailable");
          return store.abortMultipartUpload(input);
        },
      };
      await expect(
        initiateMultipartBlobStage(runtime, { ...owner, ...metadata }),
      ).rejects.toBe(failure);
      expect(inserts).toBe(1);
      expect(observed.finished()).toBe(true);
      expect(aborts).toBe(1);
      expect(await stages(owner.organizationId)).toEqual([]);
    },
  );
}
