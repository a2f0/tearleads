export interface InitialDocumentProbeBatchInput {
  readonly afterLocalId: string | null;
  readonly listedContainerIds: ReadonlySet<string>;
  readonly listedDocumentIds: ReadonlySet<string>;
}

export interface InitialDocumentProbeBatchResult {
  readonly done: boolean;
  readonly nextCursor: string | null;
  readonly requestedCount: number;
}

export interface InitialDocumentProbeHost {
  readonly listContainerDocumentIds: (
    containerId: string,
  ) => Promise<ReadonlyArray<string> | null>;
  readonly probeUndiscoveredDocumentsBatch: (
    input: InitialDocumentProbeBatchInput,
  ) => Promise<InitialDocumentProbeBatchResult>;
  readonly reportInitialDocumentProbeComplete: (requestedCount: number) => void;
}

export interface InitialDocumentProbe {
  readonly arm: (eligibleContainerIds: ReadonlyArray<string>) => void;
  readonly canRun: () => boolean;
  readonly resetPending: () => void;
  readonly run: () => Promise<void>;
}

const MAX_INITIAL_DOCUMENT_LISTING_ATTEMPTS = 3;

interface InitialDocumentProbeState {
  armed: boolean;
  cursor: string | null;
  eligibleContainerIds: Set<string>;
  generation: number;
  listedDocumentIds: ReadonlySet<string> | null;
  listedDocumentIdsByContainer: Map<string, ReadonlySet<string>>;
  listingAttemptsByContainer: Map<string, number>;
  probedContainerIds: Set<string>;
  reported: boolean;
  requestedCount: number;
  running: boolean;
}

export function scheduleInitialDocumentProbeContinuation(input: {
  readonly canContinue: () => boolean;
  readonly requestRun: () => void;
}): void {
  if (!input.canContinue()) {
    return;
  }
  setTimeout(() => {
    if (input.canContinue()) {
      input.requestRun();
    }
  }, 0);
}

function createInitialDocumentProbeState(): InitialDocumentProbeState {
  return {
    armed: false,
    cursor: null,
    eligibleContainerIds: new Set(),
    generation: 0,
    listedDocumentIds: null,
    listedDocumentIdsByContainer: new Map(),
    listingAttemptsByContainer: new Map(),
    probedContainerIds: new Set(),
    reported: false,
    requestedCount: 0,
    running: false,
  };
}

function sameIds(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function pendingProbeContainerIds(
  state: InitialDocumentProbeState,
): ReadonlyArray<string> {
  return [...state.eligibleContainerIds].filter(
    (id) => !state.probedContainerIds.has(id),
  );
}

function hasPendingWork(state: InitialDocumentProbeState): boolean {
  return (
    state.eligibleContainerIds.size > 0 &&
    ([...state.eligibleContainerIds].some(
      (id) => !state.listedDocumentIdsByContainer.has(id),
    ) ||
      pendingProbeContainerIds(state).length > 0)
  );
}

function canRun(state: InitialDocumentProbeState): boolean {
  return state.armed && !state.running && hasPendingWork(state);
}

function resetPending(state: InitialDocumentProbeState): void {
  state.generation += 1;
  state.armed = false;
  state.cursor = null;
  state.eligibleContainerIds.clear();
  state.listedDocumentIds = null;
  state.listedDocumentIdsByContainer.clear();
  state.listingAttemptsByContainer.clear();
  state.probedContainerIds.clear();
  state.reported = false;
  state.requestedCount = 0;
}

function retainEligibleProbeState(
  state: InitialDocumentProbeState,
  nextIds: ReadonlySet<string>,
): void {
  for (const containerId of state.listedDocumentIdsByContainer.keys()) {
    if (!nextIds.has(containerId)) {
      state.listedDocumentIdsByContainer.delete(containerId);
    }
  }
  for (const containerId of state.probedContainerIds) {
    if (!nextIds.has(containerId)) {
      state.probedContainerIds.delete(containerId);
    }
  }
}

function replaceEligibleContainerIds(
  state: InitialDocumentProbeState,
  nextIds: Set<string>,
): void {
  state.generation += 1;
  state.cursor = null;
  state.eligibleContainerIds = nextIds;
  state.listedDocumentIds = null;
  state.listingAttemptsByContainer.clear();
  retainEligibleProbeState(state, nextIds);
}

function resetIncompleteListingAttemptBudget(
  state: InitialDocumentProbeState,
  nextIds: ReadonlySet<string>,
): void {
  for (const containerId of nextIds) {
    if (!state.listedDocumentIdsByContainer.has(containerId)) {
      state.listingAttemptsByContainer.delete(containerId);
    }
  }
}

function armProbe(
  state: InitialDocumentProbeState,
  nextEligibleContainerIds: ReadonlyArray<string>,
): void {
  if (state.reported) {
    return;
  }
  const nextIds = new Set(nextEligibleContainerIds.filter(Boolean));
  if (!sameIds(state.eligibleContainerIds, nextIds)) {
    replaceEligibleContainerIds(state, nextIds);
  }
  if (!hasPendingWork(state)) {
    return;
  }
  if (!state.armed) {
    resetIncompleteListingAttemptBudget(state, nextIds);
  }
  state.armed = true;
}

function readListedDocumentIds(
  state: InitialDocumentProbeState,
  eligibleIds: ReadonlyArray<string>,
): ReadonlySet<string> {
  if (state.listedDocumentIds !== null) {
    return state.listedDocumentIds;
  }
  state.listedDocumentIds = new Set(
    eligibleIds.flatMap((containerId) => [
      ...(state.listedDocumentIdsByContainer.get(containerId) ?? []),
    ]),
  );
  return state.listedDocumentIds;
}

async function listNextEligibleContainer(input: {
  readonly eligibleIds: ReadonlyArray<string>;
  readonly host: InitialDocumentProbeHost;
  readonly runGeneration: number;
  readonly state: InitialDocumentProbeState;
}): Promise<boolean> {
  const { eligibleIds, host, runGeneration, state } = input;
  const containerId = eligibleIds.find(
    (id) => !state.listedDocumentIdsByContainer.has(id),
  );
  if (!containerId) {
    return false;
  }

  const documentIds = await host.listContainerDocumentIds(containerId);
  if (state.generation !== runGeneration) {
    return true;
  }
  if (documentIds === null) {
    const attempts =
      (state.listingAttemptsByContainer.get(containerId) ?? 0) + 1;
    state.listingAttemptsByContainer.set(containerId, attempts);
    // Retry transient listing failures in bounded, yielded turns. Exhaustion
    // pauses the pass until a later idle-backfill signal grants a fresh budget.
    if (attempts >= MAX_INITIAL_DOCUMENT_LISTING_ATTEMPTS) {
      state.armed = false;
    }
    return true;
  }
  state.listingAttemptsByContainer.delete(containerId);
  state.listedDocumentIdsByContainer.set(containerId, new Set(documentIds));
  return true;
}

async function runProbe(
  host: InitialDocumentProbeHost,
  state: InitialDocumentProbeState,
): Promise<void> {
  if (!canRun(state)) {
    return;
  }

  state.running = true;
  const runGeneration = state.generation;
  try {
    const eligibleIds = [...state.eligibleContainerIds];
    if (
      await listNextEligibleContainer({
        eligibleIds,
        host,
        runGeneration,
        state,
      })
    ) {
      return;
    }

    const candidateContainerIds = pendingProbeContainerIds(state);
    if (candidateContainerIds.length === 0) {
      state.armed = false;
      return;
    }
    const batch = await host.probeUndiscoveredDocumentsBatch({
      afterLocalId: state.cursor,
      listedContainerIds: new Set(candidateContainerIds),
      listedDocumentIds: readListedDocumentIds(state, eligibleIds),
    });
    if (state.generation !== runGeneration) {
      return;
    }

    state.requestedCount += batch.requestedCount;
    if (!batch.done) {
      state.cursor = batch.nextCursor;
      return;
    }
    for (const containerId of candidateContainerIds) {
      state.probedContainerIds.add(containerId);
    }
    state.cursor = null;
    state.armed = hasPendingWork(state);
    if (!state.reported) {
      state.reported = true;
      host.reportInitialDocumentProbeComplete(state.requestedCount);
    }
  } finally {
    state.running = false;
  }
}

/**
 * Runs one bounded unit per call: first one authoritative container listing,
 * then one local candidate batch. Incremental discovery watermarks are never
 * used as evidence that a document is absent from the server.
 *
 * The eligible set is replaceable because local hydration can become ready
 * before the remote tree crawl has surfaced every container. Growth before
 * completion restarts the candidate cursor; an empty early set never completes
 * the probe or prevents a later remote-containers-added signal from arming it.
 */
export function createInitialDocumentProbe(
  host: InitialDocumentProbeHost,
): InitialDocumentProbe {
  const state = createInitialDocumentProbeState();
  return {
    arm: (eligibleContainerIds) => armProbe(state, eligibleContainerIds),
    canRun: () => canRun(state),
    resetPending: () => resetPending(state),
    run: () => runProbe(host, state),
  };
}
