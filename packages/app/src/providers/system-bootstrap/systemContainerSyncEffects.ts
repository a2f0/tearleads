import type {
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useEffect, useRef } from "react";
import { findExplorerSystemNode } from "../../stores/explorer/ExplorerSystemContainers";
import type { UserSystemContainer } from "../../stores/systemContainers";

// The two post-auth sync passes SystemBootstrapProvider runs alongside the main
// device-first bootstrap: one promotes locally-created system containers to
// remote sync, the other pulls in the containers born server-side with the
// organization. Kept out of the provider so it stays within the source-shape
// budget and each pass reads on its own.

// Bounded root-lane pulls per polling sequence for the eagerly-provisioned system
// containers, so ones the server never returns cannot poll forever. The budget is
// reset each time a new sequence starts (see the effect), and polling stops the
// moment every provisioned slot surfaces in the tree, so a healthy session spends
// only a pull or two; the limit only bites the pathological never-returns case.
const PROVISIONED_SYSTEM_CONTAINER_PULL_LIMIT = 40;
const PROVISIONED_SYSTEM_CONTAINER_PULL_INTERVAL_MS = 250;

// Promote device-first (local-only) system containers into remote sync once the
// runtime is authenticated.
//
// Why this exists separately from the main bootstrap run: the provisioning
// controller creates each system slot local-only pre-auth and is deliberately
// keyed so it does NOT re-run on the bare auth transition
// (createSystemBootstrapTargetKey omits isAuthenticated to avoid re-seeding churn
// — folding auth into the key instead sends the controller into a setState loop).
// That leaves a gap: a system container created before login would otherwise stay
// local-only forever and never reach the server, so a peer granted the root never
// sees the owner's Contacts. This pass fills the gap. Once promoted Contacts is
// fully synced, the contacts axis of the bootstrap target key flips and re-runs
// the main pass to upgrade the self contact with its remote identity.
//
// Loop-safety: it only acts on slots still reporting local-only (so it stops once
// a slot converges and retries if a promotion no-ops during the auth handoff),
// guards against duplicate in-flight calls per slot, and never calls setState — a
// no-op ensureSystemContainer does not mutate the snapshot. It does NOT pass
// skipAdvancedManagedRoot: the create-intent replay keys the child for the managed
// principal exactly like a normal child create, so promotion under an org-managed
// (admins-group) root is correct, not skippable.
export function usePromoteLocalSystemContainers(input: {
  readonly currentOrganizationId: string | null | undefined;
  readonly currentRootContainerId: string | null | undefined;
  readonly enabled: boolean;
  readonly isAuthenticated: boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly snapshotNodes: ReadonlyArray<ContainerNode>;
  readonly snapshotReady: boolean;
  readonly store: ContainerContentsStore;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
}): void {
  const {
    enabled,
    currentOrganizationId,
    currentRootContainerId,
    isAuthenticated,
    logError,
    snapshotNodes,
    snapshotReady,
    store,
    systemContainers,
  } = input;
  const promotingSystemSlotsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled || !isAuthenticated || !snapshotReady) {
      return;
    }
    for (const systemContainer of systemContainers) {
      const slot = systemContainer.systemSlot;
      const node = findExplorerSystemNode(
        snapshotNodes,
        slot,
        currentOrganizationId,
        currentRootContainerId,
      );
      if (
        !node ||
        node.syncState.status !== "local-only" ||
        promotingSystemSlotsRef.current.has(slot)
      ) {
        continue;
      }

      promotingSystemSlotsRef.current.add(slot);
      void store
        .ensureSystemContainer(slot, systemContainer.name, {})
        .catch((error: unknown) => {
          logError("Failed to promote system container to remote sync", error);
        })
        .finally(() => {
          promotingSystemSlotsRef.current.delete(slot);
        });
    }
    // Narrow to the two snapshot fields this effect actually reads (ready guard +
    // nodes lookup) rather than the whole snapshot object, so it does not re-run on
    // every unrelated store update.
  }, [
    enabled,
    currentOrganizationId,
    currentRootContainerId,
    isAuthenticated,
    snapshotReady,
    snapshotNodes,
    systemContainers,
    store,
    logError,
  ]);
}

// Hydrate system containers provisioned server-side with the organization (e.g.
// the Trash bin). Unlike the local-only containers usePromoteLocalSystemContainers
// handles, these are never created device-first — a second local copy would
// collide on the per-user system slot — so they reach the tree only through sync.
// This runs on the bare auth transition (it is NOT gated on the bootstrap's
// canProvisionSystemContainers, which can stay false while the local root still
// carries its pre-registration organization id).
//
// Why poll rather than pull once: a single root-lane pull can race the store
// coming online right after registration and return nothing, and — unlike the
// Explorer's manual refresh button, which re-pulls on every click — the
// autopilot/registration path has no user nudge to try again. So pull on an
// interval until every provisioned slot surfaces (checking the live store
// snapshot, not the render's), then stop. A returning session that already loaded
// the slot from SQLite finds it present up front and never polls; the attempt
// budget only bounds the pathological slot the server never returns.
export function useProvisionedSystemContainerPull(input: {
  readonly currentOrganizationId: string | null | undefined;
  readonly currentRootContainerId: string | null | undefined;
  readonly enabled: boolean;
  readonly isAuthenticated: boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly snapshotReady: boolean;
  readonly store: ContainerContentsStore;
  readonly systemContainers: ReadonlyArray<UserSystemContainer>;
}): void {
  const {
    enabled,
    currentOrganizationId,
    currentRootContainerId,
    isAuthenticated,
    logError,
    snapshotReady,
    store,
    systemContainers,
  } = input;
  const provisionedPullTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const provisionedPullAttemptsRef = useRef(0);
  const provisionedPullInFlightRef = useRef(false);
  useEffect(() => {
    if (!enabled || !isAuthenticated || !snapshotReady) {
      return;
    }
    const provisionedSlots = systemContainers
      .filter(
        (systemContainer) => systemContainer.provisionedAtOrganizationCreation,
      )
      .map((systemContainer) => systemContainer.systemSlot);
    if (provisionedSlots.length === 0) {
      return;
    }

    const listMissingSlots = (): string[] =>
      provisionedSlots.filter(
        (slot) =>
          !findExplorerSystemNode(
            store.getSnapshot().nodes,
            slot,
            currentOrganizationId,
            currentRootContainerId,
          ),
      );

    // Already whole (synced in, or loaded from SQLite on a returning session), or
    // a poll is already running for this scope: nothing to start.
    if (listMissingSlots().length === 0 || provisionedPullTimerRef.current) {
      return;
    }

    // Fresh sequence: reset the attempt budget and the in-flight guard. The
    // provider is not remounted across org switches or a logout/login, so these
    // refs outlive any single session; without the reset a prior sequence's spent
    // attempts would accumulate and eventually starve every later session's pull
    // the moment the lifetime total crossed the limit.
    provisionedPullAttemptsRef.current = 0;
    provisionedPullInFlightRef.current = false;

    const stopPolling = () => {
      if (provisionedPullTimerRef.current) {
        clearInterval(provisionedPullTimerRef.current);
        provisionedPullTimerRef.current = null;
      }
    };

    const pullRootLane = () => {
      // 🔴FLK TEMP DEBUG (bootstrap flicker) — remove before merge.
      console.info(
        `🔴FLK[poll] tick attempt=${provisionedPullAttemptsRef.current} missing=[${listMissingSlots().length}] inFlight=${provisionedPullInFlightRef.current} rootId=${currentRootContainerId?.slice(0, 6)}`,
      );
      if (
        listMissingSlots().length === 0 ||
        provisionedPullAttemptsRef.current >=
          PROVISIONED_SYSTEM_CONTAINER_PULL_LIMIT
      ) {
        // 🔴FLK TEMP DEBUG (bootstrap flicker) — remove before merge.
        console.info(
          `🔴FLK[poll] STOP after ${provisionedPullAttemptsRef.current} attempts (missing=${listMissingSlots().length})`,
        );
        stopPolling();
        return;
      }
      // Keep pulls sequential: skip this tick if the previous root-lane pull has
      // not settled yet. Firing every interval regardless would pile up
      // concurrent requests under a slow network and burn the whole attempt
      // budget before the server answered even the first one — spending against
      // the limit only on completed round-trips is what makes it a retry budget.
      if (provisionedPullInFlightRef.current) {
        return;
      }
      provisionedPullInFlightRef.current = true;
      provisionedPullAttemptsRef.current += 1;
      void store
        .refreshRootLane({ includeActiveRootChildLane: true })
        .catch((error: unknown) => {
          logError("Failed to pull provisioned system container", error);
        })
        .finally(() => {
          provisionedPullInFlightRef.current = false;
        });
    };

    pullRootLane();
    provisionedPullTimerRef.current = setInterval(
      pullRootLane,
      PROVISIONED_SYSTEM_CONTAINER_PULL_INTERVAL_MS,
    );
    return stopPolling;
  }, [
    enabled,
    currentOrganizationId,
    currentRootContainerId,
    isAuthenticated,
    snapshotReady,
    systemContainers,
    store,
    logError,
  ]);
}
