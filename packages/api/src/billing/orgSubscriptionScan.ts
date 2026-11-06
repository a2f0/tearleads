/**
 * What a walk over an organization's Stripe subscriptions has found so far.
 * `live` and `ambiguous` are decisive and end the walk. `attemptUsed` records
 * that a terminal subscription already carries the caller's checkout attempt;
 * the walk keeps going, so a later live subscription still ends it.
 */
export type OrgSubscriptionScan =
  | { readonly status: "none"; readonly attemptUsed: boolean }
  | {
      readonly status: "pending";
      readonly subscriptionId: string;
      readonly attemptUsed: boolean;
    }
  | { readonly status: "live"; readonly subscriptionId: string }
  | { readonly status: "ambiguous" };

/** One search item, already classified by its Stripe status. */
export type OrgSubscriptionScanEvent =
  | { readonly type: "live"; readonly subscriptionId: string }
  | { readonly type: "incomplete"; readonly subscriptionId: string }
  | { readonly type: "attempt-used" };

export const initialOrgSubscriptionScan: OrgSubscriptionScan = {
  status: "none",
  attemptUsed: false,
};

export function orgSubscriptionScanIsDecisive(
  scan: OrgSubscriptionScan,
): boolean {
  return scan.status === "live" || scan.status === "ambiguous";
}

/** Ignored events return `scan` itself. */
export function transitionOrgSubscriptionScan(
  scan: OrgSubscriptionScan,
  event: OrgSubscriptionScanEvent,
): OrgSubscriptionScan {
  if (scan.status === "live" || scan.status === "ambiguous") {
    return scan;
  }
  switch (event.type) {
    case "live":
      return { status: "live", subscriptionId: event.subscriptionId };
    case "incomplete":
      // Multiple payable intents are already anomalous. Fail closed rather
      // than choosing one and creating alongside the other.
      return scan.status === "pending"
        ? { status: "ambiguous" }
        : {
            status: "pending",
            subscriptionId: event.subscriptionId,
            attemptUsed: scan.attemptUsed,
          };
    case "attempt-used":
      return scan.attemptUsed ? scan : { ...scan, attemptUsed: true };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled subscription scan event: ${JSON.stringify(value)}`,
  );
}
