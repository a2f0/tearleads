/**
 * Stripe and RevenueCat each report a Stripe subscription's billing period,
 * and either can arrive first after a renewal. Their timestamps for one
 * period can differ slightly, but never by half a period, so a timestamp is
 * matched to a period by which side of that margin it falls on. A period
 * with an unknown end has no margin.
 */

interface BillingPeriod {
  readonly endsAt: Date | null;
  readonly startsAt: Date;
}

function marginMs(period: BillingPeriod): number {
  return period.endsAt === null
    ? 0
    : (period.endsAt.getTime() - period.startsAt.getTime()) / 2;
}

/**
 * Whether a period starting at `startsAt` is `period`. An unknown start or
 * end matches nothing: a change is never made against a period it cannot
 * place.
 */
export function isSameBillingPeriod(
  startsAt: Date | null,
  period: { readonly endsAt: Date | null; readonly startsAt: Date | null },
): boolean {
  const { endsAt, startsAt: periodStartsAt } = period;
  return (
    startsAt !== null &&
    periodStartsAt !== null &&
    endsAt !== null &&
    Math.abs(startsAt.getTime() - periodStartsAt.getTime()) <
      marginMs({ endsAt, startsAt: periodStartsAt })
  );
}

/** Whether a period starting at `startsAtMs` is later than `period`. */
export function startsLaterBillingPeriod(
  startsAtMs: number,
  period: BillingPeriod,
): boolean {
  return startsAtMs > period.startsAt.getTime() + marginMs(period);
}
