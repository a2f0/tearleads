import {
  errorCauseChain,
  isSerializationFailure,
  isTransientDatabaseFailure,
  isUniqueViolationCode,
} from "../utils/databaseErrors";

const PROVIDER_SUBSCRIPTION_INDEX =
  "organization_billing_provider_subscription_idx";

/** Detects the unique constraint that enforces one native owner. */
export function isProviderSubscriptionOwnershipConflict(
  error: unknown,
): boolean {
  return errorCauseChain(error).some(
    (candidate) =>
      isUniqueViolationCode(Reflect.get(candidate, "code")) &&
      (Reflect.get(candidate, "constraint") === PROVIDER_SUBSCRIPTION_INDEX ||
        candidate.message.includes(PROVIDER_SUBSCRIPTION_INDEX)),
  );
}

/** A concurrent native move may hit ownership, serialization, or deadlock races. */
export function isNativeSubscriptionMoveConflict(error: unknown): boolean {
  return (
    isProviderSubscriptionOwnershipConflict(error) ||
    isSerializationFailure(error) ||
    isTransientDatabaseFailure(error)
  );
}
