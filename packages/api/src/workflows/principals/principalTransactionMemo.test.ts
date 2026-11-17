import { expect, test } from "bun:test";
import {
  type DatabaseTransaction,
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { organizations, principalStates } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import invariant from "invariant";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import {
  getCurrentPrincipalState,
  getCurrentPrincipalStatesFor,
  principalCurrentStateKey,
} from "../../access/read/principalStateStore";
import { forgetPrincipalTransactionMemo } from "../../access/write/principalStateStore";
import {
  loadGroupOrganizationDescriptor,
  loadOrganizationDescriptor,
} from "../organizations/organizationDescriptors";
import { lockPrincipalMutationInTransaction } from "./principalMutationLock";

async function organizationFixture() {
  const organizationId = await registerOrganization();
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization");
  return { memberGroupId: organization.memberGroupId, organizationId };
}

async function statementsOf(work: () => Promise<unknown>): Promise<number> {
  const counter = { statements: 0 };
  await withDatabaseStatementCounter(counter, work);
  return counter.statements;
}

function readOrganizationState(tx: DatabaseTransaction, id: string) {
  return getCurrentPrincipalState("organization", id, tx);
}

/** Run `work`, then roll its transaction back so the fixture is untouched. */
async function inRolledBackTransaction(
  work: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");
  await expect(
    db.transaction(async (tx) => {
      await work(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

test("a current-state read before the principal lock is never kept", async () => {
  const { organizationId } = await organizationFixture();
  await inRolledBackTransaction(async (tx) => {
    await readOrganizationState(tx, organizationId);
    expect(
      await statementsOf(() => readOrganizationState(tx, organizationId)),
    ).toBe(1);
    await lockPrincipalMutationInTransaction(
      tx,
      "organization",
      organizationId,
    );
    const locked = await readOrganizationState(tx, organizationId);
    expect(
      await statementsOf(async () =>
        expect(await readOrganizationState(tx, organizationId)).toEqual(locked),
      ),
    ).toBe(0);
  });
});

test("a set read answers locked principals from the memo and reads only the rest", async () => {
  const { memberGroupId, organizationId } = await organizationFixture();
  const organization = {
    principalId: organizationId,
    principalType: "organization",
  } as const;
  const member = {
    principalId: memberGroupId,
    principalType: "group",
  } as const;
  const missing = {
    principalId: crypto.randomUUID(),
    principalType: "group",
  } as const;
  await inRolledBackTransaction(async (tx) => {
    const unlocked = await getCurrentPrincipalStatesFor(
      [organization, member],
      tx,
    );
    await lockPrincipalMutationInTransaction(
      tx,
      "organization",
      organizationId,
    );
    await lockPrincipalMutationInTransaction(tx, "group", missing.principalId);
    // The organization is locked but not yet read: one statement reads all
    // three, and keeps the two locked answers (a missing head included).
    expect(
      await statementsOf(async () =>
        expect(
          await getCurrentPrincipalStatesFor(
            [member, organization, missing],
            tx,
          ),
        ).toEqual(unlocked),
      ),
    ).toBe(1);
    // The unlocked group is still read; the locked principals are not.
    expect(
      await statementsOf(async () =>
        expect(
          await getCurrentPrincipalStatesFor(
            [organization, member, missing],
            tx,
          ),
        ).toEqual(unlocked),
      ),
    ).toBe(1);
    expect(
      await statementsOf(async () => {
        const kept = await getCurrentPrincipalStatesFor(
          [organization, missing],
          tx,
        );
        expect([...kept.keys()]).toEqual([
          principalCurrentStateKey(organization),
        ]);
        expect(await readOrganizationState(tx, organizationId)).toEqual(
          kept.get(principalCurrentStateKey(organization)) ?? null,
        );
        expect(
          await getCurrentPrincipalState("group", missing.principalId, tx),
        ).toBeNull();
      }),
    ).toBe(0);
    // A kept head is a copy.
    const first = (await getCurrentPrincipalStatesFor([organization], tx)).get(
      principalCurrentStateKey(organization),
    );
    invariant(first, "expected organization state");
    first.stateHash = "mutated by a caller";
    expect(
      (await getCurrentPrincipalStatesFor([organization], tx)).get(
        principalCurrentStateKey(organization),
      )?.stateHash,
    ).not.toBe("mutated by a caller");
  });
});

test("the root executor never keeps a current state", async () => {
  const { organizationId } = await organizationFixture();
  await db.transaction((tx) =>
    lockPrincipalMutationInTransaction(tx, "organization", organizationId),
  );
  expect(
    await statementsOf(() =>
      getCurrentPrincipalState("organization", organizationId, db),
    ),
  ).toBe(1);
});

test("a kept state is a copy and a delete in the transaction forgets it", async () => {
  const { organizationId } = await organizationFixture();
  await inRolledBackTransaction(async (tx) => {
    await lockPrincipalMutationInTransaction(
      tx,
      "organization",
      organizationId,
    );
    const first = await readOrganizationState(tx, organizationId);
    invariant(first, "expected organization state");
    first.stateHash = "mutated by a caller";
    const second = await readOrganizationState(tx, organizationId);
    expect(second?.stateHash).not.toBe("mutated by a caller");

    forgetPrincipalTransactionMemo(tx);
    await tx
      .delete(principalStates)
      .where(
        and(
          eq(principalStates.principalType, "organization"),
          eq(principalStates.principalId, organizationId),
        ),
      );
    expect(await readOrganizationState(tx, organizationId)).toBeNull();
  });
});

test("organization descriptors are kept only under the organization lock", async () => {
  const { memberGroupId, organizationId } = await organizationFixture();
  await inRolledBackTransaction(async (tx) => {
    // The group's own lock does not cover its organization row.
    await lockPrincipalMutationInTransaction(tx, "group", memberGroupId);
    await loadGroupOrganizationDescriptor(tx, memberGroupId);
    expect(
      await statementsOf(() =>
        loadGroupOrganizationDescriptor(tx, memberGroupId),
      ),
    ).toBe(1);
    await lockPrincipalMutationInTransaction(
      tx,
      "organization",
      organizationId,
    );
    const descriptor = await loadGroupOrganizationDescriptor(tx, memberGroupId);
    expect(descriptor).toMatchObject({ memberGroupId, organizationId });
    expect(
      await statementsOf(async () => {
        expect(
          await loadGroupOrganizationDescriptor(tx, memberGroupId),
        ).toEqual(descriptor);
        expect(await loadOrganizationDescriptor(tx, organizationId)).toEqual(
          descriptor,
        );
      }),
    ).toBe(0);
    forgetPrincipalTransactionMemo(tx);
    expect(
      await statementsOf(() =>
        loadGroupOrganizationDescriptor(tx, memberGroupId),
      ),
    ).toBe(1);
  });
});
