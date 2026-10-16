import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import { createAtomicEnrollmentFixture } from "../../../test/helpers/atomicGroupEnrollment";
import { waitForPostgresLockWait } from "../../../test/helpers/postgresConcurrency";
import { lockAndFindMissingGroupReferencesInTransaction } from "../../workflows/principals/groupReferenceLock";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "compound enrollment follows the container grant reference lock order",
  async () => {
    const f = await createAtomicEnrollmentFixture(true);
    const memberId = f.organization.memberGroupId;
    const groupId = f.request.groupPolicy.state.principalId;
    expect(memberId < groupId).toBe(true);
    const locked = Promise.withResolvers<number>();
    const proceed = Promise.withResolvers<void>();
    // Pause the production grant lock helper between its sorted shared locks.
    const grantLocks = db.transaction(async (tx) => {
      await lockAndFindMissingGroupReferencesInTransaction(tx, [memberId]);
      const result = await tx.execute(sql`select pg_backend_pid() as pid`);
      locked.resolve(Number(Reflect.get(result.rows[0] ?? {}, "pid")));
      await proceed.promise;
      expect(
        await lockAndFindMissingGroupReferencesInTransaction(tx, [
          memberId,
          groupId,
        ]),
      ).toEqual([]);
    });
    void grantLocks.catch(locked.reject);
    const blockerPid = await locked.promise;
    const commit = f.commit();
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid,
        queryFragment: "pg_advisory_xact_lock",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      proceed.resolve();
    }
    const [grantResult, commitResult] = await Promise.allSettled([
      grantLocks,
      commit,
    ]);
    if (synchronizationError) throw synchronizationError;
    expect(grantResult.status).toBe("fulfilled");
    expect(commitResult.status).toBe("fulfilled");
    if (commitResult.status !== "fulfilled") throw commitResult.reason;
    expect(
      commitResult.value.status,
      await commitResult.value.clone().text(),
    ).toBe(200);
  },
  30_000,
);
