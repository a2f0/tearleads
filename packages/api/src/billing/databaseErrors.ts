const PROVIDER_SUBSCRIPTION_INDEX =
  "organization_billing_provider_subscription_idx";
const PROVIDER_SUBSCRIPTION_COLUMN =
  "organization_billing.provider_subscription_id";

function errorChain(error: unknown): Error[] {
  const errors: Error[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    errors.push(current);
    current = current.cause;
  }
  return errors;
}

/** Detects the cross-dialect unique constraint that enforces one native owner. */
export function isProviderSubscriptionOwnershipConflict(
  error: unknown,
): boolean {
  return errorChain(error).some((candidate) => {
    const code = Reflect.get(candidate, "code");
    const constraint = Reflect.get(candidate, "constraint");
    const isUniqueViolation =
      code === "23505" ||
      (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT"));
    return (
      isUniqueViolation &&
      (constraint === PROVIDER_SUBSCRIPTION_INDEX ||
        candidate.message.includes(PROVIDER_SUBSCRIPTION_INDEX) ||
        candidate.message.includes(PROVIDER_SUBSCRIPTION_COLUMN))
    );
  });
}
