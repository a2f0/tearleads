import type { PrincipalPolicyOperation } from "../../../principals/principalPolicyService";
import { prefetchDestinationProjections } from "../destination/destinationPrefetch";
import { cachedDestinationRole } from "../destination/destinationRoleCache";
import { warmListedContainerPolicies } from "../principalPolicyCache";
import type {
  ContainerChildIndex,
  ExpectedContainerState,
  FetchedContainerParentLanePage,
  HydrationOutcome,
  ListedRemoteContainerPageItem,
  QueueContainerParentLane,
  ReconnectPages,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "../types";
import { containerStateMatchesFingerprint } from "./containerStateFingerprint";
import {
  listRemoteContainerIdsWithPendingMetadataUpdates,
  listRemoteContainerIdsWithPendingStructuralIntents,
  upsertIsolatedRemoteContainerState,
} from "./remoteContainerState";

/** A retryable lane takes precedence over a refused proof elsewhere in the crawl. */
export function combineHydrationOutcomes(
  a: HydrationOutcome,
  b: HydrationOutcome,
): HydrationOutcome {
  if (a === "retry" || b === "retry") return "retry";
  if (a === "refused" || b === "refused") return "refused";
  return "complete";
}

// Re-checked inside the commit: a pause from another device can land after
// the page was filtered, and its cleanup may already have run.
function currentUnlessPaused(
  input: {
    isCurrent?: (() => boolean) | undefined;
    isPaused: (container: ListedRemoteContainerPageItem) => boolean;
  },
  container: ListedRemoteContainerPageItem,
): () => boolean {
  return () => input.isCurrent?.() !== false && !input.isPaused(container);
}

function canReuseSeenObservation(
  seenContainerObservations: ReadonlyMap<string, string>,
  state: RemoteContainerHydrationState,
  containerId: string,
  observation: string,
  isRootLane: boolean | undefined,
): boolean {
  const heldState = state.containersById.get(containerId);
  return (
    heldState !== undefined &&
    seenContainerObservations.get(containerId) === observation &&
    (!isRootLane || heldState.container.rootLaneMember === true)
  );
}

/** The local state still matches the fingerprint the listing was read at. */
function matchesListedState(
  state: RemoteContainerHydrationState,
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>,
  containerId: string,
): boolean {
  return containerStateMatchesFingerprint({
    currentState: state.containersById.get(containerId),
    expectedFingerprint: expectedContainerStates.get(containerId)?.fingerprint,
  });
}

type ApplyRemoteContainerPageInput = {
  reconnect?: ReconnectPages | undefined;
  childIdsByParentId: ContainerChildIndex;
  expectedContainerStates: ReadonlyMap<string, ExpectedContainerState>;
  expectedHydrationTombstones: FetchedContainerParentLanePage["expectedHydrationTombstones"];
  host: RemoteContainerHydrationHost;
  isCurrent?: (() => boolean) | undefined;
  isPaused: (container: ListedRemoteContainerPageItem) => boolean;
  isRootLane?: boolean | undefined;
  items: ReadonlyArray<ListedRemoteContainerPageItem>;
  /** The hydration pass's token: its pages share one directory discovery. */
  policyOperation: PrincipalPolicyOperation;
  queueParentLane: QueueContainerParentLane;
  seenContainerObservations: Map<string, string>;
  state: RemoteContainerHydrationState;
};

async function prepareRemoteContainerPage(
  input: ApplyRemoteContainerPageInput,
) {
  const { seenContainerObservations, state } = input;
  const { items, outcome } = await warmListedContainerPolicies(
    input.items,
    state.runtime.principalPolicies.createWarmer({
      operation: input.policyOperation,
      preferLocalCurrent: true,
    }),
    input.reconnect?.recordManualError,
    input.isCurrent,
  );
  if (input.isCurrent?.() === false) return null;
  const [
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
  ] = await Promise.all([
    listRemoteContainerIdsWithPendingMetadataUpdates({
      remoteContainers: items,
      state,
    }),
    listRemoteContainerIdsWithPendingStructuralIntents({
      remoteContainers: items,
      state,
    }),
  ]);
  if (input.isCurrent?.() === false) return null;
  const prefetchedProjections = await prefetchDestinationProjections({
    containers: items.filter(
      (item) =>
        !seenContainerObservations.has(item.id) &&
        !state.containersById.has(item.id) &&
        !input.expectedHydrationTombstones.get(item.id) &&
        !cachedDestinationRole(state.runtime.infra.execSql, item),
    ),
    isCurrent: input.isCurrent,
    runtime: state.runtime,
  });
  return {
    containerIdsWithPendingMetadataUpdates,
    containerIdsWithPendingStructuralIntents,
    items,
    outcome,
    prefetchedProjections,
  };
}

export async function applyRemoteContainerPage(
  input: ApplyRemoteContainerPageInput,
): Promise<{ changedCount: number; outcome: HydrationOutcome }> {
  const prepared = await prepareRemoteContainerPage(input);
  if (!prepared) {
    return { changedCount: 0, outcome: "retry" };
  }
  const { seenContainerObservations, state } = input;
  let hydratedCount = 0;
  let outcome: HydrationOutcome = prepared.outcome;
  for (const container of prepared.items) {
    if (input.isCurrent?.() === false) {
      return { changedCount: hydratedCount, outcome: "retry" };
    }
    const observation = JSON.stringify(container);
    if (
      canReuseSeenObservation(
        seenContainerObservations,
        state,
        container.id,
        observation,
        input.isRootLane,
      )
    ) {
      input.queueParentLane(container.id);
      continue;
    }
    if (
      !matchesListedState(state, input.expectedContainerStates, container.id)
    ) {
      outcome = "retry";
      continue;
    }
    let failure: HydrationOutcome = "retry";
    const upserted = await upsertIsolatedRemoteContainerState(
      {
        childIdsByParentId: input.childIdsByParentId,
        containerIdsWithPendingMetadataUpdates:
          prepared.containerIdsWithPendingMetadataUpdates,
        containerIdsWithPendingStructuralIntents:
          prepared.containerIdsWithPendingStructuralIntents,
        host: input.host,
        isCurrent: currentUnlessPaused(input, container),
        isRootLane: input.isRootLane,
        expectedHydrationTombstone:
          input.expectedHydrationTombstones.get(container.id) ?? null,
        prefetchedProjection: prepared.prefetchedProjections.get(container.id),
        remoteContainer: container,
        state,
      },
      (failedOutcome) => {
        failure = failedOutcome;
      },
      input.reconnect?.recordManualError,
    );
    if (!upserted) {
      outcome = combineHydrationOutcomes(outcome, failure);
      continue;
    }
    seenContainerObservations.set(container.id, observation);
    hydratedCount += 1;
    if (input.isCurrent?.() === false) {
      return { changedCount: hydratedCount, outcome: "retry" };
    }
    input.queueParentLane(container.id);
  }

  return { changedCount: hydratedCount, outcome };
}
