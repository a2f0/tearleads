import type {
  OrganizationBilling,
  SyncBillingGate,
} from "@tearleads/client-sdk";
import { resolveOrganizationBillingView } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";

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

const EMPTY_BLOCKED_ORGANIZATION_IDS: readonly string[] = [];

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
 *
 * `identityKey` scopes all of it to one authenticated session. The gate outlives
 * a logout — it belongs to the SDK client, not the session — so without this a
 * previous identity's block would still be listed (every block is "outside" once
 * no organization is active) and would keep warning from a stale resolution.
 */
export function useOtherOrganizationBillingBlocked(input: {
  readonly gate: SyncBillingGate;
  readonly activeOrganizationId: string | null;
  /** Identifies the authenticated session; `null` while signed out. */
  readonly identityKey: string | null;
  readonly loadBilling: (
    organizationId: string,
  ) => Promise<OrganizationBilling | null>;
}): boolean {
  const { activeOrganizationId, gate, identityKey, loadBilling } = input;
  const [, setBlockRevision] = useState(0);
  const [resolutions, setResolutions] = useState<BlockedBillingResolutions>(
    () => new Map(),
  );
  // Organizations already read or being read right now. Held in a ref, not
  // state, so it survives the effect's own cleanup: a re-run triggered by an
  // unrelated organization's block must not re-read this one, and StrictMode's
  // double invoke must not double-read any of them.
  const requestedRef = useRef<Set<string>>(new Set());
  // The session a read was started under, so a result arriving after a logout
  // or an identity switch is dropped rather than applied to the next session.
  const identityRef = useRef(identityKey);

  useEffect(
    () => gate.subscribe(() => setBlockRevision((revision) => revision + 1)),
    [gate],
  );

  // Drop every verdict when the session changes, so a new identity re-resolves
  // rather than inheriting the previous one's. Declared before the resolving
  // effect so the clear lands first when both run.
  useEffect(() => {
    identityRef.current = identityKey;
    requestedRef.current = new Set();
    setResolutions(new Map());
  }, [identityKey]);

  const blockedOrganizationIds =
    identityKey === null
      ? EMPTY_BLOCKED_ORGANIZATION_IDS
      : gate.listBlocksOutsideOrganization(activeOrganizationId);
  // Identity of the blocked set, so the resolving effect re-runs when an
  // organization is blocked or recovers but not on unrelated re-renders.
  const blockedKey = blockedOrganizationIds.join(",");

  useEffect(() => {
    const organizationIds = blockedKey.length > 0 ? blockedKey.split(",") : [];
    const blocked = new Set(organizationIds);
    // Forget recovered organizations so a later block on one reads it afresh.
    for (const organizationId of requestedRef.current) {
      if (!blocked.has(organizationId)) {
        requestedRef.current.delete(organizationId);
      }
    }
    setResolutions((current) =>
      retainBlockedResolutions(current, organizationIds),
    );

    const unread = organizationIds.filter(
      (organizationId) => !requestedRef.current.has(organizationId),
    );
    for (const organizationId of unread) {
      requestedRef.current.add(organizationId);
    }
    const identity = identityKey;
    void (async () => {
      for (const organizationId of unread) {
        const billing = await loadBilling(organizationId).catch(() => null);
        if (identityRef.current !== identity) {
          return;
        }
        // A read that fails or names another organization stays unresolved, so
        // it is retried on the next block change and never warns meanwhile.
        if (billing?.organizationId !== organizationId) {
          requestedRef.current.delete(organizationId);
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
  }, [blockedKey, identityKey, loadBilling]);

  return blockedOrganizationIds.some(
    (organizationId) => resolutions.get(organizationId) === "lapsed",
  );
}
