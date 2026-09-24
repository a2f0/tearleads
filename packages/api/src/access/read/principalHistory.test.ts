import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalContainerGrantProjection,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { listGroupHistoryThroughHeads } from "./principalHistory";

test("history reads batch over 100 heads and states without including successors or other principals", async () => {
  const user = createTestUser();
  await registerAndAuthenticate(user);
  const [template] = await db
    .select()
    .from(principalStates)
    .where(eq(principalStates.signerUserId, user.userId))
    .limit(1);
  if (!template) throw new Error("Expected policy storage fixture");
  // Exercise only the storage reader; signature verification has separate tests.
  const rows = Array.from({ length: 101 }, () => ({
    ...template,
    id: crypto.randomUUID(),
    principalType: "group" as const,
    principalId: crypto.randomUUID(),
    version: 1,
    stateHash: crypto.randomUUID(),
  }));
  const first = rows[0];
  if (!first) throw new Error("Expected first history state");
  const excluded = [
    {
      ...first,
      id: crypto.randomUUID(),
      version: 2,
      stateHash: crypto.randomUUID(),
    },
    {
      ...first,
      id: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      stateHash: crypto.randomUUID(),
    },
  ];
  const containerId = crypto.randomUUID();
  await db.insert(principalStates).values([...rows, ...excluded]);
  await db.insert(principalMembershipProjection).values(
    [...rows, ...excluded].map((row) => ({
      principalType: "group" as const,
      principalId: row.principalId,
      stateHash: row.stateHash,
      userId: user.userId,
      role: "member" as const,
    })),
  );
  await db.insert(principalContainerGrantProjection).values(
    [...rows, ...excluded].map((row) => ({
      principalType: "group" as const,
      principalId: row.principalId,
      stateHash: row.stateHash,
      containerId,
      accessLevel: "read" as const,
    })),
  );
  const select = spyOn(db, "select");
  try {
    const history = await listGroupHistoryThroughHeads(db, rows);
    expect(select).toHaveBeenCalledTimes(6);
    expect(history.map((entry) => entry.state.stateHash).sort()).toEqual(
      rows.map((row) => row.stateHash).sort(),
    );
    for (const entry of history) {
      expect(entry.projection).toMatchObject([
        { userId: user.userId, stateHash: entry.state.stateHash },
      ]);
      expect(entry.grants).toMatchObject([
        { containerId, accessLevel: "read", stateHash: entry.state.stateHash },
      ]);
    }
  } finally {
    select.mockRestore();
  }
});
