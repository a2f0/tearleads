import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStates } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import {
  getCurrentPrincipalState,
  listContainerGrantsForState,
} from "./principalStateStore";

async function storedState() {
  const user = createTestUser();
  await registerAndAuthenticate(user);
  const [row] = await db
    .select({
      principalId: principalStates.principalId,
      principalType: principalStates.principalType,
    })
    .from(principalStates)
    .where(eq(principalStates.signerUserId, user.userId))
    .limit(1);
  if (!row) throw new Error("Missing principal state fixture");
  const state = await getCurrentPrincipalState(
    row.principalType,
    row.principalId,
    db,
  );
  if (!state) throw new Error("Missing current principal state");
  return state;
}

test("a state's grant set is read from its own row", async () => {
  const state = await storedState();
  const grants = [
    { accessLevel: "write" as const, containerId: crypto.randomUUID() },
  ];
  await db
    .update(principalStates)
    .set({ containerGrants: grants })
    .where(eq(principalStates.stateHash, state.stateHash));
  expect(
    await listContainerGrantsForState(
      state.principalType,
      state.principalId,
      state.stateHash,
      db,
    ),
  ).toEqual(grants);
  expect(
    await listContainerGrantsForState(
      state.principalType,
      state.principalId,
      "0".repeat(64),
      db,
    ),
  ).toEqual([]);
});

test("a malformed stored grant set fails closed", async () => {
  const state = await storedState();
  for (const containerGrants of [
    [{ accessLevel: "owner", containerId: crypto.randomUUID() }],
    [{ accessLevel: "read" }],
    [null],
  ]) {
    await db
      .update(principalStates)
      // Simulates storage edited outside the API's typed writer.
      .set({ containerGrants: JSON.parse(JSON.stringify(containerGrants)) })
      .where(eq(principalStates.stateHash, state.stateHash));
    await expect(
      listContainerGrantsForState(
        state.principalType,
        state.principalId,
        state.stateHash,
        db,
      ),
    ).rejects.toThrow("Stored principal container grant is invalid");
  }
});
