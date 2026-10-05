import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalContainerGrantProjection,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { readPrincipalHistoryPage } from "../shared/internal/principalHistoryPage";
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
  test(`${kind} history loads 101 versions in two state pages and six queries`, async () => {
    const fixture = await seed(kind);
    const queries: unknown[][] = [];
    const history = await listPrincipalStateHistory(
      { principalType: kind, principalId: fixture.principalId, version: 101 },
      observeQueries(db, queries),
    );
    expect(queries).toHaveLength(6);
    expect([queries[0]?.length, queries[3]?.length]).toEqual([100, 1]);
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

test("one history page pins scope, lower cursor and upper version", async () => {
  const fixture = await seed("group");
  const template = fixture.rows[0];
  if (!template) throw new Error("Missing history fixture");
  await db.insert(principalStates).values({
    ...template,
    id: crypto.randomUUID(),
    principalType: "organization",
    version: 99,
    stateHash: crypto.randomUUID(),
  });
  const queries: unknown[][] = [];
  const first = await readPrincipalHistoryPage(observeQueries(db, queries), {
    principalType: "group",
    principalId: fixture.principalId,
    afterVersion: 0,
    throughVersion: 101,
  });
  expect(first).toHaveLength(100);
  expect(
    first.every(
      (entry) =>
        entry.state.principalId === fixture.principalId &&
        entry.state.principalType === "group",
    ),
  ).toBe(true);
  expect(queries).toHaveLength(3);
  expect(queries[0]).toHaveLength(100);
  const page = await readPrincipalHistoryPage(db, {
    principalType: "group",
    principalId: fixture.principalId,
    afterVersion: 98,
    throughVersion: 100,
  });
  expect(page.map((entry) => entry.state.version)).toEqual([99, 100]);
  expect(
    page.every((entry) => entry.state.principalId === fixture.principalId),
  ).toBe(true);
  const complete = await listPrincipalStateHistory(
    { principalType: "group", principalId: fixture.principalId, version: 100 },
    db,
  );
  expect(complete.map((entry) => entry.state.stateHash)).toEqual(
    fixture.rows.slice(0, 100).map((row) => row.stateHash),
  );
});

test("invalid principal history ranges are refused before database reads", async () => {
  const queries: unknown[][] = [];
  for (const range of [
    { afterVersion: -1, throughVersion: 1 },
    { afterVersion: 0.5, throughVersion: 1 },
    { afterVersion: 0, throughVersion: 0 },
    { afterVersion: 0, throughVersion: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await expect(
      readPrincipalHistoryPage(observeQueries(db, queries), {
        principalType: "group",
        principalId: crypto.randomUUID(),
        ...range,
      }),
    ).rejects.toThrow("Invalid principal history range");
  }
  expect(queries).toHaveLength(0);
});

test("completed principal history cursors do not query storage", async () => {
  const queries: unknown[][] = [];
  for (const afterVersion of [10, 11]) {
    expect(
      await readPrincipalHistoryPage(observeQueries(db, queries), {
        principalType: "group",
        principalId: crypto.randomUUID(),
        afterVersion,
        throughVersion: 10,
      }),
    ).toEqual([]);
  }
  expect(queries).toHaveLength(0);
});

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

test.each([50, 101])(
  "a missing history version %s cannot produce a complete prefix",
  async (missingVersion) => {
    const fixture = await seed("group");
    await db
      .delete(principalStates)
      .where(
        and(
          eq(principalStates.principalId, fixture.principalId),
          eq(principalStates.version, missingVersion),
        ),
      );
    await expect(
      listPrincipalStateHistory(
        {
          principalType: "group",
          principalId: fixture.principalId,
          version: 101,
        },
        db,
      ),
    ).rejects.toThrow("Stored principal history is incomplete");
  },
);
