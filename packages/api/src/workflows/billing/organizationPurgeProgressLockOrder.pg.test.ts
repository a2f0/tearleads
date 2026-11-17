import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  type ApiDatabase,
  type DatabaseTransaction,
  db,
  getDefaultApiDatabaseKind,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationGroupTombstones,
  organizations,
  principalHistoryProgress,
} from "@tearleads/api-shared/schema";
import { compareCanonicalStrings } from "@tearleads/crypto";
import { eq, inArray, sql } from "drizzle-orm";
import invariant from "invariant";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import { waitForPostgresLockWait } from "../../../test/helpers/postgresConcurrency";
import { upsertPrincipalHistoryProgress } from "../../access/write/principalHistoryProgress";
import { purgeClaimedOrganizationRemoteData } from "./organizationPurge";
import { claimOrganizationForPurge } from "./organizationPurgeCandidates";

type ProgressRow = typeof principalHistoryProgress.$inferSelect;

/** The order the post-commit publisher upserts hint rows in. */
function publisherKeyOrder(left: ProgressRow, right: ProgressRow): number {
  const key = (row: ProgressRow) =>
    JSON.stringify([
      row.principalType,
      row.principalId,
      row.verificationKind,
      row.inputHash,
      row.protectionId,
    ]);
  return (
    compareCanonicalStrings(key(left), key(right)) ||
    left.version - right.version
  );
}

/** Republish one hint row through the post-commit publisher's upsert. */
function publish(executor: DatabaseTransaction, row: ProgressRow) {
  return upsertPrincipalHistoryProgress(executor, [row]);
}

/**
 * The database with index and bitmap scans off in each transaction, so the
 * purge's lock query reads rows in storage order rather than from the
 * `(..., version)` unique index, which already yields versions ascending.
 */
const storageOrderDatabase: ApiDatabase = new Proxy(db, {
  get(target, property) {
    if (property === "transaction") {
      return (...args: Parameters<ApiDatabase["transaction"]>) => {
        const [run, config] = args;
        return target.transaction(async (tx) => {
          await tx.execute(sql`set local enable_indexscan = off`);
          await tx.execute(sql`set local enable_bitmapscan = off`);
          return run(tx);
        }, config);
      };
    }
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

async function claimedOrganizationHints() {
  const organizationId = await registerOrganization();
  const now = new Date("2099-08-30T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({ purgeAfter: new Date(now.getTime() - 1), status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const claim = await claimOrganizationForPurge(db, organizationId, now);
  invariant(claim, "expected purge claim");
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization");
  const principalIds = [
    organizationId,
    organization.adminGroupId,
    organization.memberGroupId,
  ];
  const rows = (
    await db
      .select()
      .from(principalHistoryProgress)
      .where(inArray(principalHistoryProgress.principalId, principalIds))
  ).toSorted(publisherKeyOrder);
  return { claim, now, organizationId, principalIds, rows };
}

/**
 * A publisher holds `first`, the purge starts and waits on it, and the
 * publisher then goes on, in key order, to `last` and commits. Locking in the
 * publisher's order lets both finish; another order deadlocks them.
 */
async function publishDuringPurge(input: {
  readonly claim: Parameters<
    typeof purgeClaimedOrganizationRemoteData
  >[0]["claim"];
  readonly first: ProgressRow;
  readonly last: ProgressRow;
  readonly now: Date;
  readonly purgeDatabase?: ApiDatabase;
}) {
  let held!: (backendPid: number) => void;
  let failed!: (error: unknown) => void;
  const heldFirst = new Promise<number>((resolve, reject) => {
    held = resolve;
    failed = reject;
  });
  let proceed!: () => void;
  const mayProceed = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const publisher = db.transaction(async (tx) => {
    const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
    await publish(tx, input.first);
    held(Number(Reflect.get(pid.rows[0] ?? {}, "pid")));
    await mayProceed;
    await publish(tx, input.last);
  });
  void publisher.catch(failed);
  const blockerPid = await heldFirst;
  const purge = purgeClaimedOrganizationRemoteData({
    claim: input.claim,
    db: input.purgeDatabase ?? db,
    now: input.now,
  });
  try {
    await waitForPostgresLockWait({
      blockerPid,
      queryFragment: "principal_history_progress",
    });
  } finally {
    // Let both transactions finish even if the wait was never observed.
    proceed();
    const [published, purged] = await Promise.allSettled([publisher, purge]);
    // Neither side is chosen as a deadlock victim.
    expect(published.status).toBe("fulfilled");
    expect(purged.status).toBe("fulfilled");
  }
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "organization purge locks group hints in the publisher's order",
  async () => {
    const { claim, now, organizationId, principalIds, rows } =
      await claimedOrganizationHints();
    const groupRows = rows.filter((row) => row.principalType === "group");
    const first = groupRows[0];
    const last = groupRows.at(-1);
    invariant(
      first && last && first.principalId !== last.principalId,
      "expected hint rows of both groups",
    );
    // Tombstone the key-last group first, so a purge that visits groups in
    // tombstone order reaches the key-first group's rows last.
    await db
      .insert(organizationGroupTombstones)
      .values({ groupId: last.principalId, organizationId });

    await publishDuringPurge({ claim, first, last, now });
    expect(
      await db
        .select()
        .from(principalHistoryProgress)
        .where(inArray(principalHistoryProgress.principalId, principalIds)),
    ).toEqual([]);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "organization purge locks group hints before the organization's",
  async () => {
    const { claim, now, principalIds, rows } = await claimedOrganizationHints();
    // Every group sorts before the organization in the publisher's order.
    const first = rows[0];
    const last = rows.at(-1);
    invariant(
      first?.principalType === "group" &&
        last?.principalType === "organization",
      "expected group and organization hint rows",
    );

    await publishDuringPurge({ claim, first, last, now });
    expect(
      await db
        .select()
        .from(principalHistoryProgress)
        .where(inArray(principalHistoryProgress.principalId, principalIds)),
    ).toEqual([]);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "organization purge locks a scope's versions in ascending order",
  async () => {
    const { claim, now, principalIds, rows } = await claimedOrganizationHints();
    const first = rows[0];
    invariant(first, "expected a hint row");
    // The next version of the same scope, which the publisher writes next.
    const [last] = await db
      .insert(principalHistoryProgress)
      .values({ ...first, id: randomUUID(), version: first.version + 1 })
      .returning();
    invariant(last, "expected the next version's hint row");
    // Rewrite the older version after it, so storage order puts the newer
    // version first and only the version sort locks the older one first.
    await db
      .delete(principalHistoryProgress)
      .where(eq(principalHistoryProgress.id, first.id));
    await db.insert(principalHistoryProgress).values(first);

    await publishDuringPurge({
      claim,
      first,
      last,
      now,
      purgeDatabase: storageOrderDatabase,
    });
    expect(
      await db
        .select()
        .from(principalHistoryProgress)
        .where(inArray(principalHistoryProgress.principalId, principalIds)),
    ).toEqual([]);
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "organization purge and a batched hint upsert both commit",
  async () => {
    const { claim, now, principalIds, rows } = await claimedOrganizationHints();
    const last = rows.at(-1);
    invariant(last && rows.length > 1, "expected several hint rows");
    // A gate holds the key-last row, so the publisher's one batched upsert
    // locks every earlier row and then waits there, mid-statement.
    let gateHeld!: (backendPid: number) => void;
    let gateFailed!: (error: unknown) => void;
    const gatePidReady = new Promise<number>((resolve, reject) => {
      gateHeld = resolve;
      gateFailed = reject;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = db.transaction(async (tx) => {
      const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
      await tx
        .select({ id: principalHistoryProgress.id })
        .from(principalHistoryProgress)
        .where(eq(principalHistoryProgress.id, last.id))
        .for("update");
      gateHeld(Number(Reflect.get(pid.rows[0] ?? {}, "pid")));
      await released;
    });
    void gate.catch(gateFailed);
    let publisherStarted!: (backendPid: number) => void;
    let publisherFailed!: (error: unknown) => void;
    const publisherPidReady = new Promise<number>((resolve, reject) => {
      publisherStarted = resolve;
      publisherFailed = reject;
    });
    let publisher: Promise<void> | undefined;
    let purge: Promise<unknown> | undefined;
    try {
      const gatePid = await gatePidReady;
      publisher = db.transaction(async (tx) => {
        const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
        publisherStarted(Number(Reflect.get(pid.rows[0] ?? {}, "pid")));
        // Out of key order: the publisher's own sort must order the batch.
        await upsertPrincipalHistoryProgress(tx, rows.toReversed());
      });
      void publisher.catch(publisherFailed);
      const publisherPid = await publisherPidReady;
      await waitForPostgresLockWait({
        blockerPid: gatePid,
        queryFragment: "principal_history_progress",
      });
      purge = purgeClaimedOrganizationRemoteData({ claim, db, now });
      await waitForPostgresLockWait({
        blockerPid: publisherPid,
        queryFragment: "principal_history_progress",
      });
    } finally {
      release();
      const settled = await Promise.allSettled([gate, publisher, purge]);
      // Neither the publisher nor the purge is chosen as a deadlock victim.
      expect(settled.map(({ status }) => status)).toEqual([
        "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);
    }
    expect(
      await db
        .select()
        .from(principalHistoryProgress)
        .where(inArray(principalHistoryProgress.principalId, principalIds)),
    ).toEqual([]);
  },
  30_000,
);
