import { expect, test } from "bun:test";
import {
  db,
  getDefaultApiDatabaseKind,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/test-utils";
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
  // The same statements as the feed's own read, without its transaction:
  // a mutation that carries the delta saves a whole feed request.
  expect(counter.statements).toBe(
    feedCounter.statements -
      (getDefaultApiDatabaseKind() === "postgres" ? 2 : 0),
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
