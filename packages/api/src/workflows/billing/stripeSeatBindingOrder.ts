interface StripeSeatBindingIdentity {
  readonly billingPeriodEndsAt: Date | null;
  readonly billingPeriodStartsAt: Date | null;
  readonly subscriptionId: string | null;
  readonly subscriptionItemId: string | null;
}

type StripeSeatBindingOrder = "accepted" | "retry" | "stale";

function matchesProviderIdentity(
  binding: Pick<
    StripeSeatBindingIdentity,
    "subscriptionId" | "subscriptionItemId"
  >,
  providerSubscriptionId: string | null,
): boolean {
  return (
    providerSubscriptionId !== null &&
    (providerSubscriptionId === binding.subscriptionId ||
      providerSubscriptionId === binding.subscriptionItemId)
  );
}

/**
 * Orders a candidate binding against the current durable subscription.
 * Different subscriptions only advance on a non-overlapping provider period;
 * equal/overlapping/unknown periods require an immutable RevenueCat identity.
 */
export function resolveStripeSeatBindingOrder(input: {
  readonly billingProviderSubscriptionId: string | null;
  readonly candidate: StripeSeatBindingIdentity;
  readonly current: StripeSeatBindingIdentity | undefined;
}): StripeSeatBindingOrder {
  const { candidate, current } = input;
  if (!current?.subscriptionId) {
    return "accepted";
  }
  const sameSubscription = current.subscriptionId === candidate.subscriptionId;
  const candidateStartsAt = candidate.billingPeriodStartsAt;
  const candidateEndsAt = candidate.billingPeriodEndsAt;
  const currentStartsAt = current.billingPeriodStartsAt;
  const currentEndsAt = current.billingPeriodEndsAt;
  if (
    candidateStartsAt &&
    candidateEndsAt &&
    currentStartsAt &&
    currentEndsAt
  ) {
    const samePeriod =
      candidateStartsAt.getTime() === currentStartsAt.getTime() &&
      candidateEndsAt.getTime() === currentEndsAt.getTime();
    const nonOverlappingSuccessor = candidateStartsAt >= currentEndsAt;
    const samePeriodExtension =
      sameSubscription &&
      candidateStartsAt.getTime() === currentStartsAt.getTime() &&
      candidateEndsAt >= currentEndsAt;
    if (sameSubscription) {
      return samePeriod || nonOverlappingSuccessor || samePeriodExtension
        ? "accepted"
        : "retry";
    }
    if (nonOverlappingSuccessor) {
      return "accepted";
    }
    if (candidateEndsAt <= currentStartsAt) {
      return "stale";
    }
  } else if (sameSubscription) {
    return "accepted";
  }

  const candidateOwnsBilling = matchesProviderIdentity(
    candidate,
    input.billingProviderSubscriptionId,
  );
  const currentOwnsBilling = matchesProviderIdentity(
    current,
    input.billingProviderSubscriptionId,
  );
  if (candidateOwnsBilling && !currentOwnsBilling) {
    return "accepted";
  }
  if (currentOwnsBilling && !candidateOwnsBilling) {
    return "stale";
  }
  return "retry";
}
