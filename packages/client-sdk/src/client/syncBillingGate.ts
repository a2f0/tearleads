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
  private blockedOrganizationIdValue: string | null = null;

  get blockedOrganizationId(): string | null {
    return this.blockedOrganizationIdValue;
  }

  notifyPaymentRequired(organizationId: string | null): void {
    if (this.blockedOrganizationIdValue === organizationId) {
      return;
    }
    this.blockedOrganizationIdValue = organizationId;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const organizationId = this.blockedOrganizationIdValue;
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
