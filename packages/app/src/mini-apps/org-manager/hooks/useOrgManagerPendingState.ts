import { useCallback, useMemo, useState } from "react";
import type { OrgManagerResource } from "../refresh";

const EMPTY_SETTLED_RESOURCES: Readonly<
  Partial<Record<OrgManagerResource, string>>
> = {};

/**
 * Tracks which *key* each resource was last fetched for — the organization
 * scope for the shared directory pass, the selected group id for group details.
 *
 * A plain "settled" boolean cannot answer this correctly. It stays true across
 * a switch until some effect clears it, so the first render of the new
 * organization (or the newly selected group) still reads as settled and paints
 * "hasn't synced yet" over data that is about to load. Comparing keys is
 * decided during render instead, so a switch is pending immediately, with no
 * effect ordering to get right.
 */
function useOrgManagerSettledKeys(scopeKey: string): {
  isSettled: (resource: OrgManagerResource, key: string | null) => boolean;
  markSettled: (resource: OrgManagerResource, key: string | null) => void;
} {
  // Settlements belong to the scope that produced them. Keeping them in a map
  // keyed only by resource would let a revisited scope reuse its old entry —
  // switch to another organization and back, and usage would claim to be
  // fetched while its state has been recreated as null and its fetch is only
  // just starting. Stamping the whole record with its scope drops every stale
  // entry at once.
  const [settled, setSettled] = useState<{
    readonly resources: Readonly<Partial<Record<OrgManagerResource, string>>>;
    readonly scopeKey: string;
  }>(() => ({ resources: {}, scopeKey }));
  // Reset on the scope transition itself, not merely when reading. A pure
  // read-time substitution left the stored stamp on the old scope, so an
  // A -> B -> A cycle with no B fetch returned to A and revived A's stale
  // settlements. Rewriting the stamp the moment the scope changes (React's
  // adjust-state-during-render pattern) makes the reset durable, with no stale
  // frame and no effect ordering to get right.
  if (settled.scopeKey !== scopeKey) {
    setSettled({ resources: {}, scopeKey });
  }
  const resources =
    settled.scopeKey === scopeKey ? settled.resources : EMPTY_SETTLED_RESOURCES;

  const isSettled = useCallback(
    (resource: OrgManagerResource, key: string | null) =>
      // A null key is "nothing selected", which is settled by definition: there
      // is no fetch outstanding for it.
      key === null || resources[resource] === key,
    [resources],
  );

  const markSettled = useCallback(
    (resource: OrgManagerResource, key: string | null) => {
      if (key === null) {
        return;
      }

      setSettled((current) =>
        current.scopeKey === scopeKey
          ? current.resources[resource] === key
            ? current
            : {
                resources: { ...current.resources, [resource]: key },
                scopeKey,
              }
          : { resources: { [resource]: key }, scopeKey },
      );
    },
    [scopeKey],
  );

  return useMemo(() => ({ isSettled, markSettled }), [isSettled, markSettled]);
}

function groupDetailsKey(scopeKey: string, groupId: string | null) {
  return groupId === null ? null : `${scopeKey}:${groupId}`;
}

/**
 * The pending flags the org-manager views read instead of `loading`.
 *
 * `loading` only reports an in-flight *managed* refresh. It says nothing about
 * the window before a resource's first pass — mount, an organization switch, a
 * newly selected group, SQLite still starting — where there is no projection yet
 * and no request either. Views that picked their copy off `loading` alone
 * therefore told the user data was unavailable while it was still on its way.
 */
export function useOrgManagerPendingState(input: {
  // Only a database that is still coming up counts as pending. A terminal
  // `error`/`terminated` status never becomes ready, so treating "not ready" as
  // pending would leave every view on "Loading..." forever instead of letting
  // the settled-but-empty copy (and the surfaced database error) through.
  readonly databaseStarting: boolean;
  readonly loading: boolean;
  readonly scopeKey: string;
  readonly selectedGroupId: string | null;
}): {
  readonly dataPending: boolean;
  readonly dataUsagePending: boolean;
  readonly grantsPending: boolean;
  readonly groupDetailsPending: boolean;
  readonly markDataUsageSettled: () => void;
  readonly markDirectorySettled: () => void;
  readonly markGrantsSettled: () => void;
  readonly markGroupDetailsSettled: (groupId: string | null) => void;
  readonly markOrganizationPolicyHistorySettled: () => void;
  readonly organizationPolicyHistoryPending: boolean;
} {
  const { databaseStarting, loading, scopeKey, selectedGroupId } = input;
  const { isSettled, markSettled } = useOrgManagerSettledKeys(scopeKey);
  const markDirectorySettled = useCallback(
    () => markSettled("directory", scopeKey),
    [markSettled, scopeKey],
  );
  const markDataUsageSettled = useCallback(
    () => markSettled("dataUsage", scopeKey),
    [markSettled, scopeKey],
  );
  const markGrantsSettled = useCallback(
    () => markSettled("grants", scopeKey),
    [markSettled, scopeKey],
  );
  const markOrganizationPolicyHistorySettled = useCallback(
    () => markSettled("organizationPolicyHistory", scopeKey),
    [markSettled, scopeKey],
  );
  // Keyed by scope *and* group: re-selecting the same group after the runtime
  // scope cycles (a database ready -> idle -> ready, an organization switch)
  // has to re-fetch, and a bare group id would still read as settled.
  const markGroupDetailsSettled = useCallback(
    (groupId: string | null) =>
      markSettled("groupDetails", groupDetailsKey(scopeKey, groupId)),
    [markSettled, scopeKey],
  );
  const unsettledBase = loading || databaseStarting;

  return useMemo(
    () => ({
      dataPending: unsettledBase || !isSettled("directory", scopeKey),
      // Every view-specific resource runs its own refresh, so none of them can
      // be derived from the directory's settlement: each is pending until its
      // own first pass lands.
      dataUsagePending: unsettledBase || !isSettled("dataUsage", scopeKey),
      grantsPending: unsettledBase || !isSettled("grants", scopeKey),
      organizationPolicyHistoryPending:
        unsettledBase || !isSettled("organizationPolicyHistory", scopeKey),
      groupDetailsPending:
        unsettledBase ||
        !isSettled("groupDetails", groupDetailsKey(scopeKey, selectedGroupId)),
      markDataUsageSettled,
      markDirectorySettled,
      markGrantsSettled,
      markGroupDetailsSettled,
      markOrganizationPolicyHistorySettled,
    }),
    [
      isSettled,
      markDataUsageSettled,
      markDirectorySettled,
      markGrantsSettled,
      markGroupDetailsSettled,
      markOrganizationPolicyHistorySettled,
      scopeKey,
      selectedGroupId,
      unsettledBase,
    ],
  );
}
