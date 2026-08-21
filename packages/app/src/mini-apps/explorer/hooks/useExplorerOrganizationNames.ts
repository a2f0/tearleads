import type {
  ContainerNode,
  LocalOrganizationSummary,
} from "@symcrypt/client-sdk";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const EMPTY_ORGANIZATION_NAMES: ReadonlyMap<string, string> = new Map();

// While a foreign org is still unnamed, re-attempt the lookup on this cadence.
// Its name lands in a locally-synced org-profile document whose arrival does not
// change `nodes`, so the container-driven effect would otherwise never re-run
// once the tree settles. Bounded so an org that never publishes a profile (or
// whose profile this member cannot decrypt) cannot poll forever.
const ORGANIZATION_NAME_RETRY_DELAY_MS = 500;
const ORGANIZATION_NAME_RETRY_LIMIT = 40;

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

// Re-drives name resolution while any foreign org is still pending. The
// resolution effect only re-runs on container/set changes, but a name arrives
// asynchronously via its org-profile document (which does not touch `nodes`), so
// without this the name would never surface once the tree settles. Returns a
// counter bumped on a timer; the caller feeds it into the resolution effect's
// deps. Bounded per foreign-org set so an org that never publishes (or that this
// member cannot decrypt) cannot poll forever.
function useOrganizationNameResolutionTick(input: {
  foreignOrganizationIds: ReadonlySet<string>;
  namesById: ReadonlyMap<string, string>;
  ready: boolean;
}): number {
  const { foreignOrganizationIds, namesById, ready } = input;
  const [tick, setTick] = useState(0);
  const attemptCountRef = useRef(0);

  // Whether any foreign org still lacks a name — the only condition under which
  // we need to keep re-resolving. It flips at most twice per foreign org
  // (pending -> named), so gating the timer on it (rather than on
  // `nodes`/`namesById`) keeps the interval from being torn down and rebuilt on
  // every container-tree churn. That churn is exactly what starved the previous
  // setTimeout: re-renders arriving faster than the delay cleared the pending
  // timer before it ever fired, so a name that synced mid-churn never surfaced.
  const hasPendingName =
    ready &&
    foreignOrganizationIds.size > 0 &&
    !everyOrganizationNamed(foreignOrganizationIds, namesById);
  // Stable across node-object churn: changes only when the *set* of foreign orgs
  // does, so a newly-appearing foreign org restarts the retry budget.
  const foreignIdsKey = useMemo(
    () => Array.from(foreignOrganizationIds).sort().join("\n"),
    [foreignOrganizationIds],
  );

  useEffect(() => {
    if (!hasPendingName) {
      return;
    }
    // Fresh budget for this pending phase; bounded so an org that never
    // publishes (or that this member cannot decrypt) cannot poll forever.
    attemptCountRef.current = 0;
    const timer = setInterval(() => {
      if (attemptCountRef.current >= ORGANIZATION_NAME_RETRY_LIMIT) {
        clearInterval(timer);
        return;
      }
      attemptCountRef.current += 1;
      setTick((previous) => previous + 1);
    }, ORGANIZATION_NAME_RETRY_DELAY_MS);
    return () => clearInterval(timer);
  }, [hasPendingName, foreignIdsKey]);
  return tick;
}

// The effect body of the resolution pass, lifted out of the hook so the hook
// stays a thin composition. Skips the async lookup when there is nothing new to
// resolve, and lets an in-flight lookup for the same foreign-org set finish
// rather than cancel-and-restart it.
function runOrganizationNameResolution(input: {
  listLocalOrganizations: () => Promise<
    ReadonlyArray<LocalOrganizationSummary>
  >;
  foreignOrganizationIds: ReadonlySet<string>;
  ready: boolean;
  namesRef: MutableRefObject<ReadonlyMap<string, string>>;
  lastResolvedForeignIdsRef: MutableRefObject<ReadonlySet<string>>;
  inFlightForeignIdsRef: MutableRefObject<ReadonlySet<string> | null>;
  mountedRef: MutableRefObject<boolean>;
  setNames: Dispatch<SetStateAction<ReadonlyMap<string, string>>>;
}): void {
  if (!input.ready) {
    input.lastResolvedForeignIdsRef.current = new Set();
    input.inFlightForeignIdsRef.current = null;
    return;
  }
  const { foreignOrganizationIds } = input;
  if (foreignOrganizationIds.size === 0) {
    input.lastResolvedForeignIdsRef.current = foreignOrganizationIds;
    input.inFlightForeignIdsRef.current = null;
    input.setNames((previous) =>
      previous.size === 0 ? previous : EMPTY_ORGANIZATION_NAMES,
    );
    return;
  }
  if (
    !shouldResolveOrganizationNames({
      foreignOrganizationIds,
      lastResolvedForeignIds: input.lastResolvedForeignIdsRef.current,
      namesById: input.namesRef.current,
    })
  ) {
    return;
  }
  // A lookup for this exact set is already running (a sync burst re-ran the
  // effect); let it finish instead of cancelling and restarting it.
  if (
    input.inFlightForeignIdsRef.current &&
    organizationIdSetsMatch(
      input.inFlightForeignIdsRef.current,
      foreignOrganizationIds,
    )
  ) {
    return;
  }
  input.lastResolvedForeignIdsRef.current = foreignOrganizationIds;
  input.inFlightForeignIdsRef.current = foreignOrganizationIds;

  void input
    .listLocalOrganizations()
    .then((summaries) => {
      // Superseded by a later lookup for a different foreign-org set.
      if (input.inFlightForeignIdsRef.current !== foreignOrganizationIds) {
        return;
      }
      input.inFlightForeignIdsRef.current = null;
      if (!input.mountedRef.current) {
        return;
      }
      const nextNames = buildForeignOrganizationNames(
        summaries,
        foreignOrganizationIds,
      );
      input.setNames((previous) =>
        organizationNameMapsMatch(previous, nextNames) ? previous : nextNames,
      );
    })
    .catch(() => {
      // Best-effort: keep the last resolved names on failure. Clearing the
      // in-flight marker leaves any still-unnamed org free to be retried on the
      // next container change (via shouldResolveOrganizationNames).
      if (input.inFlightForeignIdsRef.current === foreignOrganizationIds) {
        input.inFlightForeignIdsRef.current = null;
      }
    });
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
 * `listLocalOrganizations` is injected (rather than read from `useSymCrypt`
 * inside the hook) so the async resolution can be unit-tested with a fake
 * loader — the sole caller passes a `useSymCrypt`-bound, memoized callback.
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
  // Computed once per container-tree change, then shared by the retry timer and
  // the resolution effect so neither re-traverses `nodes` on every render or
  // 500ms tick.
  const foreignOrganizationIds = useMemo(
    () => collectForeignOrganizationIds(nodes, primaryOrganizationId),
    [nodes, primaryOrganizationId],
  );
  const resolveAttempt = useOrganizationNameResolutionTick({
    foreignOrganizationIds,
    namesById: organizationNamesById,
    ready,
  });
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  useEffect(() => {
    runOrganizationNameResolution({
      foreignOrganizationIds,
      inFlightForeignIdsRef,
      lastResolvedForeignIdsRef,
      listLocalOrganizations,
      mountedRef,
      namesRef: organizationNamesRef,
      ready,
      setNames: setOrganizationNamesById,
    });
  }, [foreignOrganizationIds, listLocalOrganizations, ready, resolveAttempt]);

  return organizationNamesById;
}
