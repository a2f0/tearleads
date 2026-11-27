import type {
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { useEffect, useRef } from "react";
import { findExplorerSystemNode } from "../../stores/explorer/ExplorerSystemContainers";
import type { UserSystemContainer } from "../../stores/systemContainers";
import {
  INITIAL_PROVISIONED_PULL_STATE,
  PROVISIONED_PULL_INTERVAL_MS,
  type ProvisionedPullEvent,
  type ProvisionedPullState,
  type ProvisionedPullTag,
  transitionProvisionedPull,
} from "./provisionedPullMachine";

// The two post-auth sync passes SystemBootstrapProvider runs alongside the main
// device-first bootstrap: one promotes locally-created system containers to
// remote sync, the other pulls in the containers born server-side with the
// organization. Kept out of the provider so it stays within the source-shape
// budget and each pass reads on its own.

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
        node?.syncState.status !== "local-only" ||
        promotingSystemSlotsRef.current.has(slot)
      ) {
        continue;
      }

      promotingSystemSlotsRef.current.add(slot);
      void store
        .ensureSystemContainer(slot, systemContainer.name, {
          icon: systemContainer.icon,
        })
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

// Runs one effect run (sequence) of the provisioned-container poll against the
// organization's machine in `machines`, and returns its cleanup. Every state
// change goes through `send`, and the effects (pull, timer, log) run on
// entering a state. The machine's `sequence` and `pull` tags are what keep a
// cleaned-up run from finishing a newer one.
function runProvisionedPullSequence(input: {
  readonly describeMissing: (missingSlots: ReadonlyArray<string>) => string;
  readonly key: string;
  readonly listMissingSlots: () => string[];
  readonly log: (message: string) => void;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly machines: Map<string, ProvisionedPullState>;
  readonly store: ContainerContentsStore;
}): () => void {
  const { key, listMissingSlots, machines, store } = input;
  const sequence: ProvisionedPullTag = {};
  let active = true;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const tickNow = () =>
    send({
      missingSlots: listMissingSlots(),
      pull: {},
      sequence,
      type: "tick",
    });

  const pullRootLane = (pull: ProvisionedPullTag) => {
    void store.refreshRootLane({ includeActiveRootChildLane: true }).then(
      (listed) => send({ listed, pull, type: "pull-settled" }),
      (error: unknown) => {
        // A failure from a cleaned-up run belongs to the old scope.
        if (active) {
          input.logError("Failed to pull provisioned system container", error);
        }
        send({ listed: true, pull, type: "pull-settled" });
      },
    );
  };

  const enterPolling = (
    previous: ProvisionedPullState,
    next: Extract<ProvisionedPullState, { status: "polling" }>,
  ) => {
    const previousPull = previous.status === "polling" ? previous.pull : null;
    if (next.pull && next.pull !== previousPull) pullRootLane(next.pull);
    if (previous.status === "surfacing") {
      timer = setInterval(tickNow, PROVISIONED_PULL_INTERVAL_MS);
      tickNow();
    }
  };

  const enter = (
    previous: ProvisionedPullState,
    next: ProvisionedPullState,
  ) => {
    if (next.status === "polling") return enterPolling(previous, next);
    if (next.status === "surfacing") return;
    stopTimer();
    if (next.status === "abandoned" && previous.status !== "abandoned") {
      input.log(
        `System bootstrap: ${input.describeMissing(next.missingSlots)} did not appear after ${next.listings} root-lane listing(s); stopped polling for it until the next load.`,
      );
    }
  };

  // A pull from a cleaned-up run still settles here: the listing it sent
  // counts against the organization's budget, and its tag keeps it from
  // clearing the in-flight guard of the pull that replaced it.
  function send(event: ProvisionedPullEvent): void {
    const previous = machines.get(key) ?? INITIAL_PROVISIONED_PULL_STATE;
    const next = transitionProvisionedPull(previous, event);
    if (next === previous) return;
    machines.set(key, next);
    enter(previous, next);
  }

  send({ sequence, type: "start" });
  // Surface from local SQLite first: registration and createOrganization
  // persist the provisioned containers in the same flow
  // (persistRegistrationBootstrap), so a local re-read shows them with no
  // server round-trip. Poll only for a slot it did not yield.
  if (machines.get(key)?.status === "surfacing") {
    store
      .refreshLocalContainers()
      .catch((error: unknown) => {
        if (active) {
          input.logError(
            "Failed to surface provisioned system container from local state",
            error,
          );
        }
      })
      .finally(() => {
        if (active) {
          send({
            missingSlots: listMissingSlots(),
            sequence,
            type: "surfaced",
          });
        }
      });
  }

  return () => {
    active = false;
    stopTimer();
    send({ sequence, type: "cancel" });
  };
}

// Surface the containers created in the organization's provisioning transaction
// (Trash). This runs on the bare auth transition (it is NOT gated on the
// bootstrap's canProvisionSystemContainers, which can stay false while the
// local root still carries its pre-registration organization id).
//
// Surface locally first, poll remotely only as a fallback: registration and
// createOrganization persist the provisioned container to local SQLite in the
// same flow, so a local re-read (store.refreshLocalContainers) shows it with no
// server round-trip. The remote poll is a safety net for the cases the local
// read cannot satisfy (store not yet initialized, or the freshly created org is
// not the active context yet): a single root-lane pull can race the store
// coming online right after registration, and that path has no user nudge to
// try again. A session whose tree already holds the slot never surfaces or
// polls.
//
// The poll is bounded per organization for the whole page load (see
// provisionedPullMachine): at most two root-lane listings, then it stops and
// logs the missing slot. An account registered without the slot (an SDK host
// that passed no provisioned system containers) would otherwise poll for ten
// seconds on every load.
export function useProvisionedSystemContainerPull(input: {
  readonly currentOrganizationId: string | null | undefined;
  readonly currentRootContainerId: string | null | undefined;
  readonly enabled: boolean;
  readonly isAuthenticated: boolean;
  readonly log: (message: string) => void;
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
    log,
    logError,
    snapshotReady,
    store,
    systemContainers,
  } = input;
  // One machine per organization and slot set, for the provider's lifetime.
  const machinesRef = useRef(new Map<string, ProvisionedPullState>());
  useEffect(() => {
    if (!enabled || !isAuthenticated || !snapshotReady) {
      return;
    }
    const provisionedContainers = systemContainers.filter(
      (systemContainer) => systemContainer.provisionedAtOrganizationCreation,
    );
    if (provisionedContainers.length === 0) {
      return;
    }

    const findRootId = (nodes: ReadonlyArray<ContainerNode>) =>
      nodes.find(
        (node) =>
          node.organizationId === currentOrganizationId &&
          node.parentId === null &&
          !node.systemSlot,
      )?.id ?? currentRootContainerId;
    const listMissingSlots = (): string[] => {
      const nodes = store.getSnapshot().nodes;
      const rootId = findRootId(nodes);
      return provisionedContainers.flatMap((container) =>
        nodes.some(
          (node) =>
            node.organizationId === currentOrganizationId &&
            node.parentId === rootId &&
            node.systemSlot === container.systemSlot,
        )
          ? []
          : [container.systemSlot],
      );
    };

    // Already whole: synced in, or loaded from SQLite on a returning session.
    if (listMissingSlots().length === 0) {
      return;
    }

    return runProvisionedPullSequence({
      describeMissing: (missingSlots) =>
        `${provisionedContainers
          .filter((container) => missingSlots.includes(container.systemSlot))
          .map((container) => `${container.name} (${container.systemSlot})`)
          .join(", ")} under root ${
          findRootId(store.getSnapshot().nodes) ?? "(none)"
        }`,
      key: [
        currentOrganizationId ?? "",
        ...provisionedContainers.map((container) => container.systemSlot),
      ].join("\u0000"),
      listMissingSlots,
      log,
      logError,
      machines: machinesRef.current,
      store,
    });
  }, [
    enabled,
    currentOrganizationId,
    currentRootContainerId,
    isAuthenticated,
    snapshotReady,
    systemContainers,
    store,
    log,
    logError,
  ]);
}
