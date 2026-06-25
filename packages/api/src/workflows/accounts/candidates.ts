import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { and, asc, eq, lte, or } from "drizzle-orm";
import { DISABLED_ACCOUNT_PURGE_GRACE_MS } from "../../accounts/lifecycle";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 250;

export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(limit, MAX_LIMIT);
}

export async function listPurgeCandidates(
  db: ApiDatabase,
  input: { readonly limit: number; readonly now: Date },
): Promise<Array<{ userId: string }>> {
  return db
    .select({ userId: users.id })
    .from(users)
    .where(
      or(
        and(
          eq(users.accountStatus, "disabled"),
          lte(users.purgeAfter, input.now),
        ),
        eq(users.accountStatus, "deleting"),
      ),
    )
    .orderBy(asc(users.purgeAfter), asc(users.purgeStartedAt), asc(users.id))
    .limit(input.limit);
}

export async function disableExpiredTrials(
  db: ApiDatabase,
  input: { readonly limit: number; readonly now: Date },
): Promise<void> {
  const expiredTrials = await db
    .select({ trialEndsAt: users.trialEndsAt, userId: users.id })
    .from(users)
    .where(
      and(
        eq(users.accountStatus, "trialing"),
        lte(users.trialEndsAt, input.now),
      ),
    )
    .orderBy(asc(users.trialEndsAt), asc(users.id))
    .limit(input.limit);

  for (const account of expiredTrials) {
    await db
      .update(users)
      .set({
        accountStatus: "disabled",
        disabledAt: account.trialEndsAt,
        purgeAfter: new Date(
          account.trialEndsAt.getTime() + DISABLED_ACCOUNT_PURGE_GRACE_MS,
        ),
      })
      .where(
        and(eq(users.id, account.userId), eq(users.accountStatus, "trialing")),
      );
  }
}

export async function claimAccountForPurge(
  db: ApiDatabase,
  userId: string,
  now: Date,
): Promise<{ organizationId: string; userId: string } | null> {
  const [claimed] = await db
    .update(users)
    .set({
      accountStatus: "deleting",
      purgeStartedAt: now,
    })
    .where(
      and(
        eq(users.id, userId),
        or(
          eq(users.accountStatus, "disabled"),
          eq(users.accountStatus, "deleting"),
        ),
      ),
    )
    .returning({
      organizationId: users.defaultOrganizationId,
      userId: users.id,
    });

  return claimed ?? null;
}
