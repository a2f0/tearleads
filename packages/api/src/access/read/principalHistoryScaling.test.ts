import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalContainerGrantProjection,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import {
  getCurrentPrincipalStates,
  listPrincipalStateHistory,
} from "../shared/internal/principalStateStore";

// Observe completed database round trips and transferred rows, including
// subqueries built by Drizzle, without replacing SQL execution with fixtures.
function observeQueries<T extends object>(target: T, rows: unknown[][]): T {
  return new Proxy(target, {
    get(value, key, receiver) {
      const member: unknown = Reflect.get(value, key, receiver);
      if (typeof member !== "function") return member;
      if (key === "then") {
        return (resolve: (result: unknown[]) => unknown, reject: unknown) =>
          Reflect.apply(member, value, [
            (result: unknown[]) => {
              rows.push(result);
              return resolve(result);
            },
            reject,
          ]);
      }
      return (...args: unknown[]) => {
        const next: unknown = Reflect.apply(member, value, args);
        return typeof next === "object" && next !== null
          ? observeQueries(next, rows)
          : next;
      };
    },
  });
}

async function seed(principalType: "group" | "organization") {
  const user = createTestUser();
  await registerAndAuthenticate(user);
  const [template] = await db
    .select()
    .from(principalStates)
    .where(eq(principalStates.signerUserId, user.userId))
    .limit(1);
  if (!template) throw new Error("Missing storage fixture");
  // These tests target SQL shape and artifact attachment, not cryptography.
  const principalId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const rows = Array.from({ length: 103 }, (_, index) => ({
    ...template,
    id: crypto.randomUUID(),
    principalType,
    principalId: index < 101 ? principalId : otherId,
    version: index < 101 ? index + 1 : index - 100,
    stateHash: crypto.randomUUID(),
  }));
  await db.insert(principalStates).values(rows);
  await db.insert(principalMembershipProjection).values(
    rows.map((row) => ({
      principalType,
      principalId: row.principalId,
      stateHash: row.stateHash,
      userId: user.userId,
      role: row.version % 2 ? ("admin" as const) : ("member" as const),
    })),
  );
  const containerId = crypto.randomUUID();
  await db.insert(principalContainerGrantProjection).values(
    rows.map((row) => ({
      principalType,
      principalId: row.principalId,
      stateHash: row.stateHash,
      containerId,
      accessLevel: "read" as const,
    })),
  );
  return { principalId, otherId, rows, user, containerId };
}

for (const kind of ["group", "organization"] as const) {
  test(`${kind} history loads 101 versions in five database round trips`, async () => {
    const fixture = await seed(kind);
    const queries: unknown[][] = [];
    const history = await listPrincipalStateHistory(
      kind,
      fixture.principalId,
      observeQueries(db, queries),
    );
    expect(queries).toHaveLength(5);
    expect(history.map((entry) => entry.state.stateHash)).toEqual(
      fixture.rows.slice(0, 101).map((row) => row.stateHash),
    );
    for (const entry of history) {
      expect(entry.projection).toMatchObject([
        {
          userId: fixture.user.userId,
          stateHash: entry.state.stateHash,
          role: entry.state.version % 2 ? "admin" : "member",
        },
      ]);
      expect(entry.grants).toMatchObject([
        { containerId: fixture.containerId, stateHash: entry.state.stateHash },
      ]);
    }
  });
}

test("bulk current heads transfer one row per principal, not full histories", async () => {
  const fixture = await seed("group");
  const first = fixture.rows[0];
  if (!first) throw new Error("Missing head fixture");
  await db.insert(principalStates).values({
    ...first,
    id: crypto.randomUUID(),
    principalType: "organization",
    version: 1_000,
    stateHash: crypto.randomUUID(),
  });
  const queries: unknown[][] = [];
  expect(
    await getCurrentPrincipalStates("group", [], observeQueries(db, queries)),
  ).toEqual(new Map());
  expect(queries).toHaveLength(0);
  const heads = await getCurrentPrincipalStates(
    "group",
    [
      fixture.principalId,
      fixture.otherId,
      fixture.principalId,
      crypto.randomUUID(),
    ],
    observeQueries(db, queries),
  );
  expect(heads.get(fixture.principalId)?.version).toBe(101);
  expect(heads.get(fixture.otherId)?.version).toBe(2);
  expect(heads.size).toBe(2);
  expect(queries).toHaveLength(1);
  expect(queries[0]).toHaveLength(2);
});
