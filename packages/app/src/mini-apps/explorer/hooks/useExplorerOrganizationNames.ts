import type {
  ContainerNode,
  LocalOrganizationSummary,
} from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";

const EMPTY_ORGANIZATION_NAMES: ReadonlyMap<string, string> = new Map();

function collectForeignOrganizationIds(
  nodes: ReadonlyArray<ContainerNode>,
  primaryOrganizationId: string | null,
): Set<string> {
  const organizationIds = new Set<string>();
  if (!primaryOrganizationId) {
    return organizationIds;
  }
  for (const node of nodes) {
    if (node.organizationId && node.organizationId !== primaryOrganizationId) {
      organizationIds.add(node.organizationId);
    }
  }
  return organizationIds;
}

function organizationIdSetsMatch(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const organizationId of left) {
    if (!right.has(organizationId)) {
      return false;
    }
  }
  return true;
}

function everyOrganizationNamed(
  organizationIds: ReadonlySet<string>,
  namesById: ReadonlyMap<string, string>,
): boolean {
  for (const organizationId of organizationIds) {
    if (!namesById.has(organizationId)) {
      return false;
    }
  }
  return true;
}

function organizationNameMapsMatch(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [organizationId, name] of left) {
    if (right.get(organizationId) !== name) {
      return false;
    }
  }
  return true;
}

function buildForeignOrganizationNames(
  summaries: ReadonlyArray<LocalOrganizationSummary>,
  foreignOrganizationIds: ReadonlySet<string>,
): Map<string, string> {
  const namesById = new Map<string, string>();
  for (const summary of summaries) {
    if (summary.name && foreignOrganizationIds.has(summary.organizationId)) {
      namesById.set(summary.organizationId, summary.name);
    }
  }
  return namesById;
}

// Decides whether to re-run the (async, DB-backed) name lookup. `nodes` changes
// on any container update, but the resolvable names only change when the set of
// foreign orgs changes OR when a name that was still pending finally decrypts.
// Once every foreign org is named and the set is stable, container churn can
// resolve nothing new, so the lookup is skipped.
function shouldResolveOrganizationNames(input: {
  foreignOrganizationIds: ReadonlySet<string>;
  lastResolvedForeignIds: ReadonlySet<string>;
  namesById: ReadonlyMap<string, string>;
}): boolean {
  const setChanged = !organizationIdSetsMatch(
    input.foreignOrganizationIds,
    input.lastResolvedForeignIds,
  );
  return (
    setChanged ||
    !everyOrganizationNamed(input.foreignOrganizationIds, input.namesById)
  );
}

/**
 * Resolves decrypted display names for the organizations whose containers are
 * shared into this user's Explorer from *other* organizations, so the sidebar
 * can head each foreign org's roots with its name instead of a single generic
 * "Shared with me" section.
 *
 * Best-effort: names come from locally-synced org-profile documents, so a
 * newly-shared org shows the generic heading until its profile decrypts. The
 * container snapshot (`nodes`) changes as those containers sync in, which
 * re-runs the lookup and fills the name in shortly after it lands; once every
 * foreign org is named and the set is stable the lookup idles (see
 * `shouldResolveOrganizationNames`).
 *
 * `listLocalOrganizations` is injected (rather than read from `useTearleads`
 * inside the hook) so the async resolution can be unit-tested with a fake
 * loader — the sole caller passes a `useTearleads`-bound, memoized callback.
 *
 * A sync burst re-runs the effect repeatedly with the *same* foreign-org set
 * while a name is still pending. Rather than cancel and restart the lookup each
 * time (redundant local queries, and — if churn outpaces the query — starvation
 * where no result ever lands), an in-flight lookup for the same set is left to
 * finish; only a *change* to the set supersedes it.
 */
export function useExplorerOrganizationNames(params: {
  listLocalOrganizations: () => Promise<
    ReadonlyArray<LocalOrganizationSummary>
  >;
  nodes: ReadonlyArray<ContainerNode>;
  primaryOrganizationId: string | null;
  ready: boolean;
}): ReadonlyMap<string, string> {
  const { listLocalOrganizations, nodes, primaryOrganizationId, ready } =
    params;
  const [organizationNamesById, setOrganizationNamesById] = useState<
    ReadonlyMap<string, string>
  >(EMPTY_ORGANIZATION_NAMES);
  const organizationNamesRef = useRef(organizationNamesById);
  organizationNamesRef.current = organizationNamesById;
  const lastResolvedForeignIdsRef = useRef<ReadonlySet<string>>(new Set());
  // The foreign-org set of the lookup currently in flight, or null when idle.
  // Its object identity is the supersession token: a resolving lookup applies
  // its result only while this ref still points at the exact set it queried.
  const inFlightForeignIdsRef = useRef<ReadonlySet<string> | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!ready) {
      lastResolvedForeignIdsRef.current = new Set();
      inFlightForeignIdsRef.current = null;
      return;
    }
    const foreignOrganizationIds = collectForeignOrganizationIds(
      nodes,
      primaryOrganizationId,
    );
    if (foreignOrganizationIds.size === 0) {
      lastResolvedForeignIdsRef.current = foreignOrganizationIds;
      inFlightForeignIdsRef.current = null;
      setOrganizationNamesById((previous) =>
        previous.size === 0 ? previous : EMPTY_ORGANIZATION_NAMES,
      );
      return;
    }
    if (
      !shouldResolveOrganizationNames({
        foreignOrganizationIds,
        lastResolvedForeignIds: lastResolvedForeignIdsRef.current,
        namesById: organizationNamesRef.current,
      })
    ) {
      return;
    }
    // A lookup for this exact set is already running (a sync burst re-ran the
    // effect); let it finish instead of cancelling and restarting it.
    if (
      inFlightForeignIdsRef.current &&
      organizationIdSetsMatch(
        inFlightForeignIdsRef.current,
        foreignOrganizationIds,
      )
    ) {
      return;
    }
    lastResolvedForeignIdsRef.current = foreignOrganizationIds;
    inFlightForeignIdsRef.current = foreignOrganizationIds;

    void listLocalOrganizations()
      .then((summaries) => {
        // Superseded by a later lookup for a different foreign-org set.
        if (inFlightForeignIdsRef.current !== foreignOrganizationIds) {
          return;
        }
        inFlightForeignIdsRef.current = null;
        if (!mountedRef.current) {
          return;
        }
        const nextNames = buildForeignOrganizationNames(
          summaries,
          foreignOrganizationIds,
        );
        setOrganizationNamesById((previous) =>
          organizationNameMapsMatch(previous, nextNames) ? previous : nextNames,
        );
      })
      .catch(() => {
        // Best-effort: keep the last resolved names on failure. Clearing the
        // in-flight marker leaves any still-unnamed org free to be retried on
        // the next container change (via shouldResolveOrganizationNames).
        if (inFlightForeignIdsRef.current === foreignOrganizationIds) {
          inFlightForeignIdsRef.current = null;
        }
      });
  }, [listLocalOrganizations, nodes, primaryOrganizationId, ready]);

  return organizationNamesById;
}
