import { createListenerSet } from "./listenerSet";
export type SyncBillingGateListener = (organizationId: string | null) => void;

/**
 * Signals that a sync write was rejected because its target organization cannot
 * sync (HTTP 402). Identified blocks are retained independently per org; a 402
 * without an org id is a conservative wildcard. Repeated signals for an already
 * blocked org are coalesced so they do not fan out into a refresh storm.
 */
export class SyncBillingGate {
  private readonly blockedOrganizationIds = new Set<string>();
  private readonly listeners = createListenerSet<[string | null]>();
  private readonly unknownBlockExemptOrganizationIds = new Set<string>();
  private hasUnknownOrganizationBlock = false;
  private lastBlockedOrganizationIdValue: string | null | undefined;

  get blockedOrganizationId(): string | null {
    return this.lastBlockedOrganizationIdValue ?? null;
  }

  /**
   * Whether a block is currently in effect — true even when the block carries an
   * unknown/omitted org (`null`), which `blockedOrganizationId` cannot distinguish
   * from the never-signalled state.
   */
  get isBlocked(): boolean {
    return (
      this.hasUnknownOrganizationBlock || this.blockedOrganizationIds.size > 0
    );
  }

  /**
   * Whether remote sync is blocked for a specific organization. An unattributed 402
   * without an organization id is treated conservatively as applying to every
   * organization, while an identified block remains isolated to its target.
   */
  isBlockedForOrganization(organizationId: string | null): boolean {
    if (organizationId === null) {
      return this.hasUnknownOrganizationBlock;
    }

    return (
      this.blockedOrganizationIds.has(organizationId) ||
      (this.hasUnknownOrganizationBlock &&
        !this.unknownBlockExemptOrganizationIds.has(organizationId))
    );
  }

  /**
   * The identified organizations *other than* `organizationId` that are
   * currently blocked — the footer sync indicator's "some other org cannot
   * sync" signal, since the shared billing snapshot only covers the active
   * organization. Passing `null` (no active org) lists every identified block.
   *
   * Unknown-org wildcard blocks are deliberately omitted: a caller that needs
   * to tell a lapsed organization apart from a free `local` one has to resolve
   * the org's billing, which an anonymous block gives it no way to do. Use
   * {@link isBlocked} for the conservative gate-everything reading.
   */
  listBlocksOutsideOrganization(
    organizationId: string | null,
  ): readonly string[] {
    return Array.from(this.blockedOrganizationIds).filter(
      (blockedId) => blockedId !== organizationId,
    );
  }

  notifyPaymentRequired(organizationId: string | null): void {
    if (organizationId === null) {
      if (
        this.hasUnknownOrganizationBlock &&
        this.unknownBlockExemptOrganizationIds.size === 0
      ) {
        return;
      }
      this.hasUnknownOrganizationBlock = true;
      this.unknownBlockExemptOrganizationIds.clear();
    } else {
      if (this.blockedOrganizationIds.has(organizationId)) {
        return;
      }
      this.blockedOrganizationIds.add(organizationId);
      this.unknownBlockExemptOrganizationIds.delete(organizationId);
    }
    this.lastBlockedOrganizationIdValue = organizationId;
    this.listeners.notify(organizationId);
  }

  /**
   * Clear one recovered organization without disturbing other org blocks. A
   * named recovery exempts only that org from an unattributed unknown-org wildcard;
   * unrelated orgs remain conservatively blocked. Omitting the argument retains
   * the public clear-all behavior. Recovery does not notify subscribers because
   * the billing refetch that observed it already represents the state change.
   */
  clearBlock(organizationId?: string | null): void {
    if (organizationId === undefined) {
      this.blockedOrganizationIds.clear();
      this.hasUnknownOrganizationBlock = false;
      this.unknownBlockExemptOrganizationIds.clear();
      this.lastBlockedOrganizationIdValue = undefined;
      return;
    }

    if (organizationId === null) {
      this.hasUnknownOrganizationBlock = false;
      this.unknownBlockExemptOrganizationIds.clear();
    } else {
      this.blockedOrganizationIds.delete(organizationId);
      if (this.hasUnknownOrganizationBlock) {
        this.unknownBlockExemptOrganizationIds.add(organizationId);
      }
    }
    this.refreshLastBlockedOrganizationId();
  }

  private refreshLastBlockedOrganizationId(): void {
    if (this.hasUnknownOrganizationBlock) {
      this.lastBlockedOrganizationIdValue = null;
      return;
    }

    this.lastBlockedOrganizationIdValue = Array.from(
      this.blockedOrganizationIds,
    ).at(-1);
  }

  subscribe = (listener: SyncBillingGateListener): (() => void) =>
    this.listeners.subscribe(listener);
}
