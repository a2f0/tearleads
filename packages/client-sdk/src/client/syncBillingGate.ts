export type SyncBillingGateListener = (organizationId: string | null) => void;

/**
 * Signals that a sync write was rejected because its target organization cannot
 * sync (HTTP 402). Mirrors {@link Network}: it holds the last blocked org and
 * notifies subscribers only when that value changes, so a burst of 402s for the
 * same org does not fan out into a refresh storm. The app subscribes to refetch
 * billing and surface the block.
 *
 * Note: the gate is not reset on recovery, so a same-session block → subscribe →
 * re-lapse for the same org does not re-notify; the app's other refresh triggers
 * (mount, active-org change, manual refresh) cover that case.
 */
export class SyncBillingGate {
  private readonly listeners = new Set<SyncBillingGateListener>();
  // `undefined` is the "never signalled" sentinel, distinct from a `null` org
  // id (a 402 whose body omitted the org) — so the first `null` notification is
  // still a change and reaches subscribers instead of being coalesced away.
  private blockedOrganizationIdValue: string | null | undefined;

  get blockedOrganizationId(): string | null {
    return this.blockedOrganizationIdValue ?? null;
  }

  /**
   * Whether a block is currently in effect — true even when the block carries an
   * unknown/omitted org (`null`), which `blockedOrganizationId` cannot distinguish
   * from the never-signalled state.
   */
  get isBlocked(): boolean {
    return this.blockedOrganizationIdValue !== undefined;
  }

  notifyPaymentRequired(organizationId: string | null): void {
    if (this.blockedOrganizationIdValue === organizationId) {
      return;
    }
    this.blockedOrganizationIdValue = organizationId;
    this.notifyListeners();
  }

  /**
   * Reset the gate after billing recovers (the org can sync again), so a later
   * block re-signals instead of being coalesced against the stale value. Does
   * not notify subscribers: recovery is already reflected by the billing
   * refetch that observed it, and notifying would trigger a redundant refetch.
   */
  clearBlock(): void {
    this.blockedOrganizationIdValue = undefined;
  }

  private notifyListeners(): void {
    const organizationId = this.blockedOrganizationIdValue ?? null;
    for (const listener of this.listeners) {
      try {
        listener(organizationId);
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  }

  subscribe = (listener: SyncBillingGateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
