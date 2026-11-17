import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  containers,
  documents,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  insertDereferencedBlob,
  registerOrganization,
} from "../../../test/helpers/organizationPurge";
import { purgeClaimedOrganizationRemoteData } from "../../workflows/billing/organizationPurge";
import { claimOrganizationForPurge } from "../../workflows/billing/organizationPurgeCandidates";
import { runReclaimDereferencedBlobsWorkflow } from "../../workflows/blobs/gc/reclaimDereferencedBlobs";

// Far enough ahead that wall-clock GC sweeps in other test files never select
// this file's dereferenced blobs.
const NOW = new Date("2099-08-30T12:00:00.000Z");

async function countOrganizationPurge(input: {
  readonly extraBlobs: number;
  readonly extraDocuments: number;
}) {
  const organizationId = await registerOrganization();
  const [root] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.organizationId, organizationId));
  invariant(root, "expected organization root");
  for (let index = 0; index < input.extraDocuments; index += 1) {
    const containerId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    await db.insert(containers).values({
      depth: 1,
      id: containerId,
      organizationId,
      parentId: root.id,
    });
    await db
      .insert(documents)
      .values({ id: documentId, createdByFingerprint: "purge-budget" });
    await db
      .insert(containerMetadataDocuments)
      .values({ containerId, documentId });
  }
  for (let index = 0; index < input.extraBlobs; index += 1) {
    await insertDereferencedBlob(organizationId, NOW);
  }
  await db
    .update(organizationBilling)
    .set({ purgeAfter: new Date(NOW.getTime() - 1), status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const claim = await claimOrganizationForPurge(db, organizationId, NOW);
  invariant(claim, "expected purge claim");
  const counter = { statements: 0 };
  const purged = await withDatabaseStatementCounter(counter, () =>
    purgeClaimedOrganizationRemoteData({ claim, db, now: NOW }),
  );
  invariant(purged, "expected purge to run");
  return counter.statements;
}

// The reclaim call the organization purge makes for each batch of its blobs.
async function countOrganizationBlobReclaim(blobCount: number) {
  const organizationId = await registerOrganization();
  const blobIds: string[] = [];
  for (let index = 0; index < blobCount; index += 1) {
    blobIds.push(await insertDereferencedBlob(organizationId, NOW));
  }
  const counter = { statements: 0 };
  const result = await withDatabaseStatementCounter(counter, () =>
    runReclaimDereferencedBlobsWorkflow(db, {
      blobIds,
      gracePeriodMs: 0,
      limit: blobIds.length,
      now: NOW,
    }),
  );
  expect(result.reclaimedBlobIds.toSorted()).toEqual(blobIds.toSorted());
  expect(result.revivedBlobIds).toEqual([]);
  return counter.statements;
}

test("organization purge statements do not grow with its documents", async () => {
  const one = await countOrganizationPurge({
    extraBlobs: 0,
    extraDocuments: 1,
  });
  const three = await countOrganizationPurge({
    extraBlobs: 0,
    extraDocuments: 3,
  });
  expect(three).toBe(one);
  // Budget: the highest count across PGlite, SQLite and PostgreSQL, which
  // count the transaction's BEGIN and COMMIT. 61 / 63 / 63 before the
  // document-baseline, principal epoch-key, and built-in grant tables were
  // retired; 57 / 59 / 59 after. Locking the organization and its two
  // groups before deleting their principal states adds three advisory locks
  // where PGlite and Postgres take them: 60 / 59 / 62. Deleting the history
  // progress of the organization and every group it had adds one statement:
  // 61 on PGlite, 63 on PostgreSQL.
  expect(one).toBeLessThanOrEqual(63);
});

test("organization purge statements do not grow with its blobs", async () => {
  const one = await countOrganizationPurge({
    extraBlobs: 1,
    extraDocuments: 0,
  });
  const three = await countOrganizationPurge({
    extraBlobs: 3,
    extraDocuments: 0,
  });
  expect(three).toBe(one);
  // Budget: PGlite / PostgreSQL. Dereferencing the blobs is one update per
  // batch of 500 (61 / 63); locking each batch in UUID order first, so the
  // update cannot deadlock with a reclaim chunk, adds one lock: 62 / 64.
  expect(one).toBeLessThanOrEqual(64);
});

test("organization blob reclaim statements do not grow with its blobs", async () => {
  const one = await countOrganizationBlobReclaim(1);
  const five = await countOrganizationBlobReclaim(5);
  expect({ five, one }).toEqual({ five: one, one });
  // Budget: PGlite / PostgreSQL, two candidate selects plus one transaction
  // per chunk of up to 500 blobs (PostgreSQL counts its BEGIN and COMMIT).
  // One transaction per blob cost 11 / 13 for one blob and 47 / 57 for five.
  expect(one).toBeLessThanOrEqual(13);
});
