import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  users,
  userTwoFactor,
  userTwoFactorRecoveryCodes,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  acceptTotpStep,
  consumeRecoveryCode,
  countRecoveryCodes,
} from "./store";

async function insertEnrolledUser(lockedUntil: Date): Promise<string> {
  const [user] = await db
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
  if (!user) throw new Error("expected inserted user");
  await db.insert(userTwoFactor).values({
    enabledAt: new Date(lockedUntil.getTime() - 3_600_000),
    lockedUntil,
    secretCiphertext: "sealed",
    userId: user.id,
  });
  await db
    .insert(userTwoFactorRecoveryCodes)
    .values({ codeHash: "issued-code-hash", userId: user.id });
  return user.id;
}

test("a lockout refuses a correct code checked against a record read before it", async () => {
  // Another request's fifth wrong code locked entry after this one read the
  // record unlocked; acceptance must re-check the lock itself.
  const lockedUntil = new Date(Date.now() + 600_000);
  const userId = await insertEnrolledUser(lockedUntil);
  const during = new Date(lockedUntil.getTime() - 1_000);

  expect(
    await acceptTotpStep(db, { enabling: false, now: during, step: 7, userId }),
  ).toBeNull();
  expect(
    await consumeRecoveryCode(db, {
      codeHash: "issued-code-hash",
      now: during,
      userId,
    }),
  ).toBe(false);
  expect(await countRecoveryCodes(db, userId)).toBe(1);

  const after = new Date(lockedUntil.getTime() + 1_000);
  expect(
    await acceptTotpStep(db, { enabling: false, now: after, step: 7, userId }),
  ).not.toBeNull();
  expect(
    await consumeRecoveryCode(db, {
      codeHash: "issued-code-hash",
      now: after,
      userId,
    }),
  ).toBe(true);
  const [record] = await db
    .select({ lastUsedStep: userTwoFactor.lastUsedStep })
    .from(userTwoFactor)
    .where(eq(userTwoFactor.userId, userId));
  expect(record?.lastUsedStep).toBe(7);
});
