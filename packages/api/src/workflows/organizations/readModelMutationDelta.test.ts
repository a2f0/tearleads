import { expect, test } from "bun:test";
import {
  db,
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
import { sql } from "drizzle-orm";
import invariant from "invariant";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { loadOrganizationReadModelSnapshot } from "../../../test/helpers/organizationReadModel";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { appendOrganizationReadModelChangeInTransaction } from "./readModelChanges";
import {
  decodeOrganizationReadModelCursor,
  encodeOrganizationReadModelCursor,
} from "./readModelCursor";
import { runGetOrganizationReadModelWorkflow } from "./readModelFeed";
import { loadCommittedReadModelDeltaInTransaction } from "./readModelMutationDelta";

async function organizationWithSnapshot() {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerAndAuthenticateUsers(owner, outsider);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const snapshot = await loadOrganizationReadModelSnapshot(
    owner,
    organizationId,
  );
  return { organizationId, outsider, owner, snapshot };
}

test("the committer's delta is the feed's page, under the feed's access check", async () => {
  const { organizationId, outsider, owner, snapshot } =
    await organizationWithSnapshot();
  const counter = { statements: 0 };
  const deltas = await db.transaction(async (tx) => {
    const input = { heldCursor: snapshot.nextCursor, organizationId, tx };
    const beforeStamp = await loadCommittedReadModelDeltaInTransaction({
      ...input,
      sessionUserId: owner.userId,
    });
    // A group write stamps twice; the delta is built after the last stamp.
    await appendOrganizationReadModelChangeInTransaction(tx, {
      lanes: ["groups"],
      organizationId,
    });
    await appendOrganizationReadModelChangeInTransaction(tx, {
      lanes: ["organizationPolicy"],
      organizationId,
    });
    const refused = await loadCommittedReadModelDeltaInTransaction({
      ...input,
      sessionUserId: outsider.userId,
    });
    const served = await withDatabaseStatementCounter(counter, () =>
      loadCommittedReadModelDeltaInTransaction({
        ...input,
        sessionUserId: owner.userId,
      }),
    );
    return { beforeStamp, refused, served };
  });
  expect(deltas.beforeStamp).toBeUndefined();
  expect(deltas.refused).toBeUndefined();
  const heldPosition = decodeOrganizationReadModelCursor(
    snapshot.nextCursor,
    organizationId,
  );
  expect(deltas.served?.nextCursor).toBe(
    encodeOrganizationReadModelCursor(organizationId, heldPosition + 2n),
  );
  const feedCounter = { statements: 0 };
  const feed = await withDatabaseStatementCounter(feedCounter, () =>
    runGetOrganizationReadModelWorkflow(
      db,
      organizationId,
      owner.userId,
      snapshot.nextCursor,
    ),
  );
  invariant(feed.mode === "delta", "expected a feed delta");
  expect(deltas.served).toEqual(feed);
  // The feed's own statements, with a savepoint's two control statements in
  // place of the feed's transaction control (which PGlite does not count): a
  // mutation that carries the delta saves a whole feed request.
  expect(counter.statements).toBe(
    feedCounter.statements +
      (getDefaultApiDatabaseKind() === "postgres" ? 0 : 2),
  );
});

test("a held cursor other than the head before the first stamp earns no delta", async () => {
  const { organizationId, owner, snapshot } = await organizationWithSnapshot();
  const heldPosition = decodeOrganizationReadModelCursor(
    snapshot.nextCursor,
    organizationId,
  );
  const { afterFirstStamp, otherOrganization } = await db.transaction(
    async (tx) => {
      await appendOrganizationReadModelChangeInTransaction(tx, {
        lanes: ["groups"],
        organizationId,
      });
      await appendOrganizationReadModelChangeInTransaction(tx, {
        lanes: ["directory"],
        organizationId,
      });
      return {
        afterFirstStamp: await loadCommittedReadModelDeltaInTransaction({
          heldCursor: encodeOrganizationReadModelCursor(
            organizationId,
            heldPosition + 1n,
          ),
          organizationId,
          sessionUserId: owner.userId,
          tx,
        }),
        otherOrganization: await loadCommittedReadModelDeltaInTransaction({
          heldCursor: snapshot.nextCursor,
          organizationId: crypto.randomUUID(),
          sessionUserId: owner.userId,
          tx,
        }),
      };
    },
  );
  expect(afterFirstStamp).toBeUndefined();
  expect(otherOrganization).toBeUndefined();
});

test("a delta read that fails in SQL leaves the mutation's transaction usable", async () => {
  const { organizationId, owner, snapshot } = await organizationWithSnapshot();
  const delta = await db.transaction(async (tx) => {
    await appendOrganizationReadModelChangeInTransaction(tx, {
      lanes: ["directory"],
      organizationId,
    });
    // The directory lane's query then fails in SQL, inside the savepoint.
    await tx.execute(
      sql`alter table organization_roster_entries rename to roster_entries_hidden`,
    );
    const served = await loadCommittedReadModelDeltaInTransaction({
      heldCursor: snapshot.nextCursor,
      organizationId,
      sessionUserId: owner.userId,
      tx,
    });
    // An aborted transaction would refuse this statement.
    await tx.execute(
      sql`alter table roster_entries_hidden rename to organization_roster_entries`,
    );
    return served;
  });

  expect(delta).toBeUndefined();
  const feed = await runGetOrganizationReadModelWorkflow(
    db,
    organizationId,
    owner.userId,
    snapshot.nextCursor,
  );
  expect(Object.keys(feed.lanes)).toEqual(["directory"]);
});
