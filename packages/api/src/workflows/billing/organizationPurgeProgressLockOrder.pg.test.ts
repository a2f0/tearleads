import { expect, test } from "bun:test";
import {
  type DatabaseTransaction,
  db,
  getDefaultApiDatabaseKind,
} from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
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

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "organization purge locks progress rows in the hint publisher's order",
  async () => {
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
    const first = rows[0];
    const last = rows.at(-1);
    invariant(first && last && first !== last, "expected two hint rows");
    // Rewrite the key-first row at the end of the heap, so a scan in storage
    // order reaches it last.
    await db
      .delete(principalHistoryProgress)
      .where(eq(principalHistoryProgress.id, first.id));
    await db.insert(principalHistoryProgress).values(first);

    // A publisher upserting these hints holds the key-first row and, in key
    // order, goes on to the last one only once the purge waits on it.
    let held!: (backendPid: number) => void;
    const heldFirst = new Promise<number>((resolve) => {
      held = resolve;
    });
    let proceed!: () => void;
    const mayProceed = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const publisher = db.transaction(async (tx) => {
      const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
      await touch(tx, first);
      held(Number(Reflect.get(pid.rows[0] ?? {}, "pid")));
      await mayProceed;
      await touch(tx, last);
    });
    const blockerPid = await heldFirst;
    const purge = purgeClaimedOrganizationRemoteData({ claim, db, now });
    await waitForPostgresLockWait({
      blockerPid,
      queryFragment: "principal_history_progress",
    });
    proceed();

    // Neither side is chosen as a deadlock victim.
    await publisher;
    expect(await purge).toBeDefined();
    expect(
      await db
        .select()
        .from(principalHistoryProgress)
        .where(inArray(principalHistoryProgress.principalId, principalIds)),
    ).toEqual([]);
  },
  30_000,
);
