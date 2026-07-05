import type { AccountStatus } from "@tearleads/api-shared/schema";
import type { AccountLifecycleResponse } from "@tearleads/validators/response";

const FREE_TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
export const DISABLED_ACCOUNT_PURGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccountLifecycle {
  readonly status: AccountStatus;
  readonly trialEndsAt: Date;
  readonly disabledAt: Date | null;
  readonly purgeAfter: Date | null;
  readonly purgeStartedAt: Date | null;
  readonly purgedAt: Date | null;
  readonly remoteDataEpoch: number;
}

export function createTrialAccountFields(now: Date = new Date()): {
  readonly accountStatus: AccountStatus;
  readonly trialEndsAt: Date;
  readonly remoteDataEpoch: number;
} {
  return {
    accountStatus: "trialing",
    trialEndsAt: new Date(now.getTime() + FREE_TRIAL_MS),
    remoteDataEpoch: 1,
  };
}

export function serializeAccountLifecycle(
  account: AccountLifecycle,
): AccountLifecycleResponse {
  return {
    status: account.status,
    trialEndsAt: account.trialEndsAt.toISOString(),
    disabledAt: account.disabledAt?.toISOString() ?? null,
    purgeAfter: account.purgeAfter?.toISOString() ?? null,
    purgeStartedAt: account.purgeStartedAt?.toISOString() ?? null,
    purgedAt: account.purgedAt?.toISOString() ?? null,
    remoteDataEpoch: account.remoteDataEpoch,
  };
}
