import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  userTwoFactor,
  userTwoFactorRecoveryCodes,
} from "@tearleads/api-shared/schema";
import {
  and,
  count,
  eq,
  exists,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

/** Consecutive wrong codes that start a lockout. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface TwoFactorRecord {
  readonly enabledAt: Date | null;
  readonly failedAttempts: number;
  readonly lastUsedStep: number | null;
  readonly lockedUntil: Date | null;
  readonly secretCiphertext: string;
  readonly userId: string;
}

export const twoFactorRecordColumns = {
  enabledAt: userTwoFactor.enabledAt,
  failedAttempts: userTwoFactor.failedAttempts,
  lastUsedStep: userTwoFactor.lastUsedStep,
  lockedUntil: userTwoFactor.lockedUntil,
  secretCiphertext: userTwoFactor.secretCiphertext,
  userId: userTwoFactor.userId,
};

export async function loadTwoFactorRecord(
  executor: DatabaseSession,
  userId: string,
): Promise<TwoFactorRecord | undefined> {
  const [row] = await executor
    .select(twoFactorRecordColumns)
    .from(userTwoFactor)
    .where(eq(userTwoFactor.userId, userId))
    .limit(1);
  return row;
}

/**
 * Stores a pending secret, replacing an earlier pending one. Returns false
 * when two-factor is already on, which a pending secret must never replace.
 */
export async function savePendingTwoFactorSecret(
  executor: DatabaseSession,
  input: {
    readonly now: Date;
    readonly secretCiphertext: string;
    readonly userId: string;
  },
): Promise<boolean> {
  const rows = await executor
    .insert(userTwoFactor)
    .values({
      createdAt: input.now,
      secretCiphertext: input.secretCiphertext,
      updatedAt: input.now,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        failedAttempts: 0,
        lastUsedStep: null,
        lockedUntil: null,
        secretCiphertext: input.secretCiphertext,
        updatedAt: input.now,
      },
      setWhere: isNull(userTwoFactor.enabledAt),
      target: userTwoFactor.userId,
    })
    .returning({ userId: userTwoFactor.userId });
  return rows.length > 0;
}

/**
 * No lockout in force at `now`. Acceptance re-checks it in the same
 * statement, so codes checked in parallel with the failure that started a
 * lockout are refused, not accepted from a record read before it.
 */
function notLockedAt(now: Date) {
  return or(
    isNull(userTwoFactor.lockedUntil),
    lte(userTwoFactor.lockedUntil, now),
  );
}

function stepIsFresh(step: number) {
  return or(
    isNull(userTwoFactor.lastUsedStep),
    lt(userTwoFactor.lastUsedStep, step),
  );
}

/**
 * Records an accepted authenticator code. The step guard makes acceptance
 * atomic: of two requests carrying the same code, only one advances the step,
 * and the other is refused as a replay. `enabling` turns on a pending row.
 */
export async function acceptTotpStep(
  executor: DatabaseSession,
  input: {
    readonly enabling: boolean;
    readonly now: Date;
    readonly step: number;
    readonly userId: string;
  },
): Promise<Date | null> {
  const [row] = await executor
    .update(userTwoFactor)
    .set({
      failedAttempts: 0,
      lastUsedStep: input.step,
      lockedUntil: null,
      updatedAt: input.now,
      ...(input.enabling ? { enabledAt: input.now } : {}),
    })
    .where(
      and(
        eq(userTwoFactor.userId, input.userId),
        input.enabling
          ? isNull(userTwoFactor.enabledAt)
          : isNotNull(userTwoFactor.enabledAt),
        stepIsFresh(input.step),
        notLockedAt(input.now),
      ),
    )
    .returning({ enabledAt: userTwoFactor.enabledAt });
  return row?.enabledAt ?? null;
}

/**
 * Spends one recovery code; false when it was never issued, was already used,
 * or a lockout is in force.
 */
export async function consumeRecoveryCode(
  executor: DatabaseSession,
  input: {
    readonly codeHash: string;
    readonly now: Date;
    readonly userId: string;
  },
): Promise<boolean> {
  const unlocked = executor
    .select({ userId: userTwoFactor.userId })
    .from(userTwoFactor)
    .where(
      and(
        eq(userTwoFactor.userId, input.userId),
        isNotNull(userTwoFactor.enabledAt),
        notLockedAt(input.now),
      ),
    );
  const rows = await executor
    .delete(userTwoFactorRecoveryCodes)
    .where(
      and(
        eq(userTwoFactorRecoveryCodes.userId, input.userId),
        eq(userTwoFactorRecoveryCodes.codeHash, input.codeHash),
        exists(unlocked),
      ),
    )
    .returning({ codeHash: userTwoFactorRecoveryCodes.codeHash });
  if (rows.length === 0) return false;
  await executor
    .update(userTwoFactor)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(userTwoFactor.userId, input.userId));
  return true;
}

/**
 * Counts a wrong code. The fifth in a row locks code entry and restarts the
 * count, so each later lockout again takes five wrong codes. Returns the
 * lockout end when this failure started one.
 */
export async function recordFailedCode(
  executor: DatabaseSession,
  input: { readonly now: Date; readonly userId: string },
): Promise<Date | null> {
  const reachesLimit = sql`${userTwoFactor.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS}`;
  const lockedUntil = new Date(input.now.getTime() + LOCKOUT_MS);
  const [row] = await executor
    .update(userTwoFactor)
    .set({
      failedAttempts: sql`CASE WHEN ${reachesLimit} THEN 0 ELSE ${userTwoFactor.failedAttempts} + 1 END`,
      lockedUntil: sql`CASE WHEN ${reachesLimit} THEN ${sql.param(lockedUntil, userTwoFactor.lockedUntil)} ELSE ${userTwoFactor.lockedUntil} END`,
      updatedAt: input.now,
    })
    .where(eq(userTwoFactor.userId, input.userId))
    .returning({ lockedUntil: userTwoFactor.lockedUntil });
  return row?.lockedUntil && row.lockedUntil > input.now
    ? row.lockedUntil
    : null;
}

async function replaceRecoveryCodes(
  executor: DatabaseSession,
  input: {
    readonly hashes: readonly string[];
    readonly now: Date;
    readonly userId: string;
  },
): Promise<void> {
  await executor
    .delete(userTwoFactorRecoveryCodes)
    .where(eq(userTwoFactorRecoveryCodes.userId, input.userId));
  await executor.insert(userTwoFactorRecoveryCodes).values(
    input.hashes.map((codeHash) => ({
      codeHash,
      createdAt: input.now,
      userId: input.userId,
    })),
  );
}

export async function countRecoveryCodes(
  executor: DatabaseSession,
  userId: string,
): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(userTwoFactorRecoveryCodes)
    .where(eq(userTwoFactorRecoveryCodes.userId, userId));
  return row?.value ?? 0;
}

async function deleteTwoFactor(
  executor: DatabaseSession,
  userId: string,
): Promise<void> {
  await executor
    .delete(userTwoFactorRecoveryCodes)
    .where(eq(userTwoFactorRecoveryCodes.userId, userId));
  await executor.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
}

/**
 * Turns a pending record on with an accepted step and stores its first
 * recovery codes, in one transaction. Null when the step was refused.
 */
export function confirmTwoFactorEnrollment(
  db: ApiDatabase,
  input: {
    readonly hashes: readonly string[];
    readonly now: Date;
    readonly step: number;
    readonly userId: string;
  },
): Promise<Date | null> {
  return db.transaction(async (tx) => {
    const enabledAt = await acceptTotpStep(tx, {
      enabling: true,
      now: input.now,
      step: input.step,
      userId: input.userId,
    });
    if (enabledAt) await replaceRecoveryCodes(tx, input);
    return enabledAt;
  });
}

/** Replaces every recovery code in one transaction. */
export function reissueRecoveryCodes(
  db: ApiDatabase,
  input: {
    readonly hashes: readonly string[];
    readonly now: Date;
    readonly userId: string;
  },
): Promise<void> {
  return db.transaction((tx) => replaceRecoveryCodes(tx, input));
}

/** Forgets the secret and the recovery codes in one transaction. */
export function removeTwoFactor(
  db: ApiDatabase,
  userId: string,
): Promise<void> {
  return db.transaction((tx) => deleteTwoFactor(tx, userId));
}
