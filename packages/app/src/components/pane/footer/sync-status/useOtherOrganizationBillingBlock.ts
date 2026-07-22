import type {
  OrganizationBilling,
  SyncBillingGate,
} from "@tearleads/client-sdk";
import { resolveOrganizationBillingView } from "@tearleads/client-sdk";
import { useEffect, useState } from "react";

/**
 * How a 402-blocked organization's billing resolved. `lapsed` is the only state
 * that warrants a warning: it mirrors `OrganizationBillingView.needsAttention`,
 * which excludes the free `local` tier. That exclusion is the whole point of
 * resolving at all — the server 402s a `local` organization exactly as it does a
 * `past_due` one, so the block alone cannot tell "you must pay to resume sync"
 * apart from "this organization was never syncing in the first place".
 */
type BlockedBillingResolution = "lapsed" | "syncable";

type BlockedBillingResolutions = ReadonlyMap<string, BlockedBillingResolution>;

function resolveBlockedBilling(
  billing: OrganizationBilling,
  nowMs: number,
): BlockedBillingResolution {
  return resolveOrganizationBillingView(billing, nowMs).needsAttention
    ? "lapsed"
    : "syncable";
}

/**
 * Drop resolutions for organizations that are no longer blocked, so a later
 * block on the same organization is resolved afresh rather than trusting a
 * verdict from a previous episode. Returns the original map when nothing was
 * dropped, keeping the hook's state identity stable.
 */
function retainBlockedResolutions(
  resolutions: BlockedBillingResolutions,
  blockedOrganizationIds: readonly string[],
): BlockedBillingResolutions {
  const blocked = new Set(blockedOrganizationIds);
  const retained = new Map(
    Array.from(resolutions).filter(([organizationId]) =>
      blocked.has(organizationId),
    ),
  );
  return retained.size === resolutions.size ? resolutions : retained;
}

/**
 * Whether an organization *other than* the active one cannot sync because its
 * billing lapsed.
 *
 * The shared billing snapshot covers only the active organization, so a lapse
 * elsewhere is known only from that organization's 402 (see `SyncBillingGate`).
 * It matters because the write queue is identity-wide: the stranded
 * organization's writes are counted by the very indicator this feeds. Each
 * blocked organization's billing is then read once — a bounded fetch, normally
 * none — so a free `local` organization, which is 402'd for the same reason but
 * is not a lapse, does not raise a warning.
 *
 * The blocked list is read on every render rather than mirrored into state,
 * because `clearBlock` (the recovery path in `BillingProvider`) deliberately
 * does not notify subscribers; the subscription only exists to re-render on a
 * *new* block, while a recovery is picked up by the re-render its own billing
 * refetch causes.
 */
export function useOtherOrganizationBillingBlocked(input: {
  readonly gate: SyncBillingGate;
  readonly activeOrganizationId: string | null;
  readonly loadBilling: (
    organizationId: string,
  ) => Promise<OrganizationBilling | null>;
}): boolean {
  const { activeOrganizationId, gate, loadBilling } = input;
  const [, setBlockRevision] = useState(0);
  const [resolutions, setResolutions] = useState<BlockedBillingResolutions>(
    () => new Map(),
  );

  useEffect(
    () => gate.subscribe(() => setBlockRevision((revision) => revision + 1)),
    [gate],
  );

  const blockedOrganizationIds =
    gate.listBlocksOutsideOrganization(activeOrganizationId);
  // Identity of the blocked set, so the resolving effect re-runs when an
  // organization is blocked or recovers but not on unrelated re-renders.
  const blockedKey = blockedOrganizationIds.join(",");

  useEffect(() => {
    const organizationIds = blockedKey.length > 0 ? blockedKey.split(",") : [];
    setResolutions((current) =>
      retainBlockedResolutions(current, organizationIds),
    );
    let cancelled = false;
    void (async () => {
      for (const organizationId of organizationIds) {
        const billing = await loadBilling(organizationId).catch(() => null);
        if (cancelled) {
          return;
        }
        // A read that fails or names another organization stays unresolved, so
        // it is retried on the next block change and never warns meanwhile.
        if (billing?.organizationId !== organizationId) {
          continue;
        }
        const resolution = resolveBlockedBilling(billing, Date.now());
        setResolutions((current) =>
          current.get(organizationId) === resolution
            ? current
            : new Map(current).set(organizationId, resolution),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blockedKey, loadBilling]);

  return blockedOrganizationIds.some(
    (organizationId) => resolutions.get(organizationId) === "lapsed",
  );
}
