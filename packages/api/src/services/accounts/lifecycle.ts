import type { AccountStatus } from "@tearleads/api-shared/schema";
import { users } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import {
  type AccountLifecycle,
  DISABLED_ACCOUNT_PURGE_GRACE_MS,
} from "../../accounts/lifecycle";
import type { ApiServiceRuntime } from "../runtime";

class AccountLifecycleError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 500,
  ) {
    super(message);
  }
}

function accountLifecycleFromUser(user: {
  accountStatus: AccountStatus;
  disabledAt: Date | null;
  purgeAfter: Date | null;
  purgeStartedAt: Date | null;
  purgedAt: Date | null;
  remoteDataEpoch: number;
  trialEndsAt: Date;
}): AccountLifecycle {
  return {
    status: user.accountStatus,
    trialEndsAt: user.trialEndsAt,
    disabledAt: user.disabledAt,
    purgeAfter: user.purgeAfter,
    purgeStartedAt: user.purgeStartedAt,
    purgedAt: user.purgedAt,
    remoteDataEpoch: user.remoteDataEpoch,
  };
}

async function loadAccountLifecycle(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<AccountLifecycle> {
  const [user] = await runtime.db
    .select({
      accountStatus: users.accountStatus,
      disabledAt: users.disabledAt,
      purgeAfter: users.purgeAfter,
      purgeStartedAt: users.purgeStartedAt,
      purgedAt: users.purgedAt,
      remoteDataEpoch: users.remoteDataEpoch,
      trialEndsAt: users.trialEndsAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new AccountLifecycleError("Account not found", 404);
  }

  return accountLifecycleFromUser(user);
}

export async function resolveAccountLifecycle(
  runtime: ApiServiceRuntime,
  userId: string,
  now: Date = new Date(),
): Promise<AccountLifecycle> {
  const account = await loadAccountLifecycle(runtime, userId);
  if (account.status !== "trialing" || account.trialEndsAt > now) {
    return account;
  }

  const disabledAt = account.trialEndsAt;
  const purgeAfter = new Date(
    disabledAt.getTime() + DISABLED_ACCOUNT_PURGE_GRACE_MS,
  );
  const [updated] = await runtime.db
    .update(users)
    .set({
      accountStatus: "disabled",
      disabledAt,
      purgeAfter,
    })
    .where(and(eq(users.id, userId), eq(users.accountStatus, "trialing")))
    .returning({
      accountStatus: users.accountStatus,
      disabledAt: users.disabledAt,
      purgeAfter: users.purgeAfter,
      purgeStartedAt: users.purgeStartedAt,
      purgedAt: users.purgedAt,
      remoteDataEpoch: users.remoteDataEpoch,
      trialEndsAt: users.trialEndsAt,
    });

  if (!updated) {
    return loadAccountLifecycle(runtime, userId);
  }

  return accountLifecycleFromUser(updated);
}
