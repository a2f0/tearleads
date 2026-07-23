import { useCallback, useMemo, useState } from "react";

/** A resource whose first fetch the views must not mistake for an empty one. */
type OrgManagerSettledResource = "directory" | "groupDetails";

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
function useOrgManagerSettledKeys(): {
  isSettled: (
    resource: OrgManagerSettledResource,
    key: string | null,
  ) => boolean;
  markSettled: (
    resource: OrgManagerSettledResource,
    key: string | null,
  ) => void;
} {
  const [settledKeys, setSettledKeys] = useState<
    Readonly<Partial<Record<OrgManagerSettledResource, string>>>
  >({});

  const isSettled = useCallback(
    (resource: OrgManagerSettledResource, key: string | null) =>
      // A null key is "nothing selected", which is settled by definition: there
      // is no fetch outstanding for it.
      key === null || settledKeys[resource] === key,
    [settledKeys],
  );

  const markSettled = useCallback(
    (resource: OrgManagerSettledResource, key: string | null) => {
      if (key === null) {
        return;
      }

      setSettledKeys((current) =>
        current[resource] === key ? current : { ...current, [resource]: key },
      );
    },
    [],
  );

  return useMemo(() => ({ isSettled, markSettled }), [isSettled, markSettled]);
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
  readonly databaseReady: boolean;
  readonly loading: boolean;
  readonly scopeKey: string;
  readonly selectedGroupId: string | null;
}): {
  readonly dataPending: boolean;
  readonly groupDetailsPending: boolean;
  readonly markDirectorySettled: () => void;
  readonly markSettled: (resource: "groupDetails", key: string | null) => void;
} {
  const { databaseReady, loading, scopeKey, selectedGroupId } = input;
  const { isSettled, markSettled } = useOrgManagerSettledKeys();
  const markDirectorySettled = useCallback(
    () => markSettled("directory", scopeKey),
    [markSettled, scopeKey],
  );
  const unsettledBase = loading || !databaseReady;

  return useMemo(
    () => ({
      dataPending: unsettledBase || !isSettled("directory", scopeKey),
      // Group details carry no loading flag of their own, so the selected
      // group's own fetch needs its own settle key.
      groupDetailsPending:
        unsettledBase || !isSettled("groupDetails", selectedGroupId),
      markDirectorySettled,
      markSettled,
    }),
    [
      isSettled,
      markDirectorySettled,
      markSettled,
      scopeKey,
      selectedGroupId,
      unsettledBase,
    ],
  );
}
