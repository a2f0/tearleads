import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { blobStages, organizationBilling } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { declaredFirstPart } from "../../../test/helpers/blobStageParts";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import {
  observeTransactionProgress,
  probeTransactions,
  queryGate,
} from "../../../test/helpers/transactionProgress";
import { purgeClaimedOrganizationRemoteData } from "../../workflows/billing/organizationPurge";
import { claimOrganizationForPurge } from "../../workflows/billing/organizationPurgeCandidates";
import { initiateMultipartBlobStage } from "./multipartStage";

const postgresTest = test.skipIf(getDefaultApiDatabaseKind() !== "postgres");

postgresTest(
  "two stages hold organization protection concurrently",
  async () => {
    const { input } = await fixture();
    const firstGate = queryGate((query) =>
      query.startsWith('insert into "blob_stages"'),
    );
    const secondGate = queryGate((query) =>
      query.startsWith('insert into "blob_stages"'),
    );
    const first = probeTransactions(db, { before: firstGate.hook });
    const second = probeTransactions(db, { before: secondGate.hook });
    const stageOne = settle(
      initiateMultipartBlobStage(
        createServiceTestRuntime(first.database),
        input,
      ),
    );
    let stageTwo: typeof stageOne | undefined;
    try {
      await firstGate.waitFor(stageOne);
      stageTwo = settle(
        initiateMultipartBlobStage(
          createServiceTestRuntime(second.database),
          input,
        ),
      );
      const secondPid = await second.started;
      expect(secondPid).not.toBe(await first.started);
      const observed = await observeTransactionProgress({
        pid: secondPid,
        progressed: secondGate.arrived,
        finished: second.finished,
      });
      expect(observed.outcome).toBe("progressed");
      expect(observed.activity).toMatchObject({ blockers: [] });
      expect(first.finished()).toBe(false);
      expect(second.finished()).toBe(false);
      expect(await stages(input.organizationId)).toEqual([]);
    } finally {
      firstGate.release();
      secondGate.release();
      await Promise.all([stageOne, stageTwo]);
    }
    expect(await stageOne).toMatchObject({ status: "fulfilled" });
    expect(await stageTwo).toMatchObject({ status: "fulfilled" });
    expect(await stages(input.organizationId)).toHaveLength(2);
  },
  30_000,
);

async function fixture() {
  const owner = await createBlobStageOwner();
  const input = {
    ...owner,
    byteLength: 1,
    firstParts: declaredFirstPart(1),
    sha256: "encrypted-sha256",
  };
  const now = new Date();
  await db
    .update(organizationBilling)
    .set({ status: "disabled", purgeAfter: new Date(now.getTime() - 1) })
    .where(eq(organizationBilling.organizationId, owner.organizationId));
  return { input, now };
}

async function claimPurge(organizationId: string, now: Date) {
  const claim = await claimOrganizationForPurge(db, organizationId, now);
  invariant(claim, "expected purge claim");
  return claim;
}

function stages(organizationId: string) {
  return db
    .select()
    .from(blobStages)
    .where(eq(blobStages.organizationId, organizationId));
}

function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
}

postgresTest(
  "a rechecked stage holds purge until its insert is covered by the sweep",
  async () => {
    const { input, now } = await fixture();
    const gate = queryGate((query) =>
      query.startsWith('insert into "blob_stages"'),
    );
    const staging = probeTransactions(db, { before: gate.hook });
    const runtime = createServiceTestRuntime(staging.database);
    const stage = settle(initiateMultipartBlobStage(runtime, input));
    let purge:
      | ReturnType<typeof purgeClaimedOrganizationRemoteData>
      | undefined;
    try {
      await gate.waitFor(stage);
      // The insert is reached only after both transaction rechecks succeeded.
      expect(await stages(input.organizationId)).toEqual([]);
      const claim = await claimPurge(input.organizationId, now);
      const purging = probeTransactions(db);
      purge = purgeClaimedOrganizationRemoteData({
        claim,
        db: purging.database,
        now,
      });
      const observed = await observeTransactionProgress({
        pid: await purging.started,
        progressed: () => false,
        finished: purging.finished,
      });
      expect(observed.outcome).toBe("blocked");
      expect(observed.activity).toMatchObject({
        query: expect.stringContaining('update "organizations"'),
        blockers: [await staging.started],
      });
    } finally {
      gate.release();
      await Promise.all([stage, purge]);
    }
    expect(await stage).toMatchObject({ status: "fulfilled" });
    expect(await purge).toBeDefined();
    const rows = await stages(input.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.expiresAt.getTime()).toBe(now.getTime());
  },
  30_000,
);

postgresTest(
  "a stage behind purge rechecks after the sweep and aborts its upload",
  async () => {
    const { input, now } = await fixture();
    const uploadCreated = Promise.withResolvers<void>();
    const releaseUpload = Promise.withResolvers<void>();
    const staging = probeTransactions(db);
    const runtime = createServiceTestRuntime(staging.database);
    const store = runtime.blobObjectStore;
    const aborted: string[] = [];
    runtime.blobObjectStore = {
      ...store,
      createMultipartUpload: async (request) => {
        const upload = await store.createMultipartUpload(request);
        uploadCreated.resolve();
        await releaseUpload.promise;
        return upload;
      },
      abortMultipartUpload: async (request) => {
        aborted.push(request.key);
        await store.abortMultipartUpload(request);
      },
    };
    const stage = settle(initiateMultipartBlobStage(runtime, input));
    const gate = queryGate((query) =>
      query.startsWith('update "organizations"'),
    );
    let purge:
      | ReturnType<typeof purgeClaimedOrganizationRemoteData>
      | undefined;
    try {
      await uploadCreated.promise;
      const claim = await claimPurge(input.organizationId, now);
      const purging = probeTransactions(db, { after: gate.hook });
      purge = purgeClaimedOrganizationRemoteData({
        claim,
        db: purging.database,
        now,
      });
      await gate.waitFor(purge);
      releaseUpload.resolve();
      const observed = await observeTransactionProgress({
        pid: await staging.started,
        progressed: () => false,
        finished: staging.finished,
      });
      expect(observed.outcome).toBe("blocked");
      expect(observed.activity).toMatchObject({
        query: expect.stringContaining('from "organizations"'),
        blockers: [await purging.started],
      });
    } finally {
      releaseUpload.resolve();
      gate.release();
      await Promise.all([stage, purge]);
    }
    expect(await purge).toBeDefined();
    expect(await stage).toMatchObject({
      status: "rejected",
      error: { status: 409 },
    });
    expect(aborted).toHaveLength(1);
    expect(await stages(input.organizationId)).toEqual([]);
  },
  30_000,
);
