import { expect, test } from "bun:test";
import {
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

/** Lock a hint row as the publisher's conflicting upsert does. */
function touch(executor: DatabaseTransaction, row: ProgressRow) {
  return executor
    .update(principalHistoryProgress)
    .set({ updatedAt: new Date() })
    .where(eq(principalHistoryProgress.id, row.id));
}

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
    await touch(tx, input.first);
    held(Number(Reflect.get(pid.rows[0] ?? {}, "pid")));
    await mayProceed;
    await touch(tx, input.last);
  });
  void publisher.catch(failed);
  const blockerPid = await heldFirst;
  const purge = purgeClaimedOrganizationRemoteData({
    claim: input.claim,
    db,
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
