import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createRecordUserActivity } from "./userActivity";

async function insertUser(): Promise<string> {
  const [inserted] = await db
    .insert(users)
    .values({
      defaultOrganizationId: crypto.randomUUID(),
      encapsulationKeyFingerprint: crypto.randomUUID().replaceAll("-", ""),
      encapsulationPublicKey: "kem",
      fingerprint: `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
        "-",
        "",
      ),
      signingPublicKey: "signing",
    })
    .returning({ id: users.id });
  if (!inserted) {
    throw new Error("expected inserted user");
  }
  return inserted.id;
}

async function readLastActiveAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastActiveAt: users.lastActiveAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.lastActiveAt ?? null;
}

test("recording user activity only moves last_active_at forward", async () => {
  const userId = await insertUser();
  const recordUserActivity = createRecordUserActivity(db);
  const later = Date.UTC(2026, 8, 6, 12, 0, 0);
  const earlier = later - 60_000;

  await expect(readLastActiveAt(userId)).resolves.toBeNull();

  await recordUserActivity({ lastActiveAt: later, userId });
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));

  await recordUserActivity({ lastActiveAt: earlier, userId });
  await expect(readLastActiveAt(userId)).resolves.toEqual(new Date(later));

  await recordUserActivity({ lastActiveAt: later + 1_000, userId });
  await expect(readLastActiveAt(userId)).resolves.toEqual(
    new Date(later + 1_000),
  );
});

test("recording activity for an unknown user is a no-op", async () => {
  const recordUserActivity = createRecordUserActivity(db);
  await expect(
    recordUserActivity({
      lastActiveAt: Date.now(),
      userId: "00000000-0000-4000-8000-000000000000",
    }),
  ).resolves.toBeUndefined();
});
