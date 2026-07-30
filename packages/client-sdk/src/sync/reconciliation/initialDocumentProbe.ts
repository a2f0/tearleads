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
  readonly continuationDelayMs: () => number;
  readonly hasPendingWork: () => boolean;
  readonly resetPending: () => void;
  readonly resetSkippedListings: () => void;
  readonly run: () => Promise<void>;
}

const MAX_INITIAL_DOCUMENT_LISTING_ATTEMPTS = 3;
const INITIAL_DOCUMENT_LISTING_RETRY_BASE_DELAY_MS = 1_000;

interface InitialDocumentProbeState {
  armed: boolean;
  cursor: string | null;
  eligibleContainerIds: Set<string>;
  generation: number;
  listedDocumentIds: ReadonlySet<string> | null;
  listedDocumentIdsByContainer: Map<string, ReadonlySet<string>>;
  listingAttemptsByContainer: Map<string, number>;
  listingRetryNotBeforeByContainer: Map<string, number>;
  probedContainerIds: Set<string>;
  reported: boolean;
  requestedCount: number;
  running: boolean;
  skippedContainerIds: Set<string>;
}

export function scheduleInitialDocumentProbeContinuation(input: {
  readonly canContinue: () => boolean;
  readonly delayMs: number;
  readonly requestRun: () => void;
}): () => void {
  if (!input.canContinue()) {
    return () => undefined;
  }
  const timeout = setTimeout(() => {
    if (input.canContinue()) {
      input.requestRun();
    }
  }, input.delayMs);
  return () => clearTimeout(timeout);
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
    listingRetryNotBeforeByContainer: new Map(),
    probedContainerIds: new Set(),
    reported: false,
    requestedCount: 0,
    running: false,
    skippedContainerIds: new Set(),
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

function canRun(state: InitialDocumentProbeState, nowMs = Date.now()): boolean {
  if (!state.armed || state.running || !hasPendingWork(state)) {
    return false;
  }
  const unlistedContainerIds = [...state.eligibleContainerIds].filter(
    (id) => !state.listedDocumentIdsByContainer.has(id),
  );
  return (
    unlistedContainerIds.length === 0 ||
    unlistedContainerIds.some(
      (id) => (state.listingRetryNotBeforeByContainer.get(id) ?? 0) <= nowMs,
    )
  );
}

function continuationDelayMs(
  state: InitialDocumentProbeState,
  nowMs = Date.now(),
): number {
  const retryTimes = [...state.eligibleContainerIds]
    .filter((id) => !state.listedDocumentIdsByContainer.has(id))
    .map((id) => state.listingRetryNotBeforeByContainer.get(id) ?? 0);
  if (retryTimes.length === 0 || retryTimes.some((time) => time <= nowMs)) {
    return 0;
  }
  return Math.max(0, Math.min(...retryTimes) - nowMs);
}

function resetPending(state: InitialDocumentProbeState): void {
  state.generation += 1;
  state.armed = false;
  state.cursor = null;
  state.eligibleContainerIds.clear();
  state.listedDocumentIds = null;
  state.listedDocumentIdsByContainer.clear();
  state.listingAttemptsByContainer.clear();
  state.listingRetryNotBeforeByContainer.clear();
  state.probedContainerIds.clear();
  state.reported = false;
  state.requestedCount = 0;
  state.skippedContainerIds.clear();
}

function resetSkippedListings(state: InitialDocumentProbeState): void {
  if (state.skippedContainerIds.size === 0) {
    return;
  }
  // A reconnect is a new opportunity for lanes that exhausted their bounded
  // listing retries. Preserve completed healthy lanes, but invalidate any
  // candidate cursor because the authoritative listing set can now grow.
  state.generation += 1;
  state.armed = false;
  state.cursor = null;
  state.listedDocumentIds = null;
  state.listingAttemptsByContainer.clear();
  state.listingRetryNotBeforeByContainer.clear();
  state.reported = false;
  state.requestedCount = 0;
  state.skippedContainerIds.clear();
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
  for (const containerId of state.listingAttemptsByContainer.keys()) {
    if (!nextIds.has(containerId)) {
      state.listingAttemptsByContainer.delete(containerId);
      state.listingRetryNotBeforeByContainer.delete(containerId);
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
  retainEligibleProbeState(state, nextIds);
}

function armProbe(
  state: InitialDocumentProbeState,
  nextEligibleContainerIds: ReadonlyArray<string>,
): void {
  if (state.reported) {
    return;
  }
  const nextIds = new Set(
    nextEligibleContainerIds.filter(
      (id) => Boolean(id) && !state.skippedContainerIds.has(id),
    ),
  );
  if (!sameIds(state.eligibleContainerIds, nextIds)) {
    replaceEligibleContainerIds(state, nextIds);
  }
  if (!hasPendingWork(state)) {
    return;
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
  const nowMs = Date.now();
  const containerId = eligibleIds.find(
    (id) =>
      !state.listedDocumentIdsByContainer.has(id) &&
      (state.listingRetryNotBeforeByContainer.get(id) ?? 0) <= nowMs,
  );
  if (!containerId) {
    return false;
  }

  let documentIds: ReadonlyArray<string> | null;
  try {
    documentIds = await host.listContainerDocumentIds(containerId);
  } catch {
    documentIds = null;
  }
  if (state.generation !== runGeneration) {
    return true;
  }
  if (documentIds === null) {
    const attempts =
      (state.listingAttemptsByContainer.get(containerId) ?? 0) + 1;
    state.listingAttemptsByContainer.set(containerId, attempts);
    // Retry transient listing failures with bounded, seconds-scale backoff.
    // Exhausted lanes are skipped until prerequisites are regained so healthy
    // lanes can converge without suppressing the failed lane forever.
    if (attempts >= MAX_INITIAL_DOCUMENT_LISTING_ATTEMPTS) {
      state.skippedContainerIds.add(containerId);
      state.eligibleContainerIds.delete(containerId);
      state.listingAttemptsByContainer.delete(containerId);
      state.listingRetryNotBeforeByContainer.delete(containerId);
    } else {
      const retryDelayMs =
        INITIAL_DOCUMENT_LISTING_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1);
      state.listingRetryNotBeforeByContainer.set(
        containerId,
        Date.now() + retryDelayMs,
      );
    }
    return true;
  }
  state.listingAttemptsByContainer.delete(containerId);
  state.listingRetryNotBeforeByContainer.delete(containerId);
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
    if (eligibleIds.some((id) => !state.listedDocumentIdsByContainer.has(id))) {
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
      if (batch.nextCursor !== null) {
        state.cursor = batch.nextCursor;
        return;
      }
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
    continuationDelayMs: () => continuationDelayMs(state),
    hasPendingWork: () => state.armed && hasPendingWork(state),
    resetPending: () => resetPending(state),
    resetSkippedListings: () => resetSkippedListings(state),
    run: () => runProbe(host, state),
  };
}
