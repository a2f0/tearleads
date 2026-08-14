import {
  errorCauseChain,
  isLockContention,
  isSerializationFailure,
  isTransientDatabaseFailure,
  isUniqueViolationCode,
} from "../utils/databaseErrors";

const PROVIDER_SUBSCRIPTION_INDEX =
  "organization_billing_provider_subscription_idx";
const PROVIDER_SUBSCRIPTION_COLUMN =
  "organization_billing.provider_subscription_id";

/** Detects the cross-dialect unique constraint that enforces one native owner. */
export function isProviderSubscriptionOwnershipConflict(
  error: unknown,
): boolean {
  return errorCauseChain(error).some((candidate) => {
    const constraint = Reflect.get(candidate, "constraint");
    return (
      isUniqueViolationCode(Reflect.get(candidate, "code")) &&
      (constraint === PROVIDER_SUBSCRIPTION_INDEX ||
        candidate.message.includes(PROVIDER_SUBSCRIPTION_INDEX) ||
        candidate.message.includes(PROVIDER_SUBSCRIPTION_COLUMN))
    );
  });
}

/** A concurrent native move may hit ownership, serialization, or lock races. */
export function isNativeSubscriptionMoveConflict(error: unknown): boolean {
  return (
    isProviderSubscriptionOwnershipConflict(error) ||
    isSerializationFailure(error) ||
    isLockContention(error) ||
    isTransientDatabaseFailure(error)
  );
}
