import { MAX_CONTAINER_DOCUMENT_LANES } from "@tearleads/validators/request";
import type { ReconciliationClock } from "./clock";

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
  readonly clock: ReconciliationClock;
  /**
   * Each container's authoritative current document ids, read from no
   * watermark in one batched listing. A lane that could not be listed maps
   * to `null` or is absent.
   */
  readonly listContainerDocumentIds: (
    containerIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyMap<string, ReadonlyArray<string> | null>>;
  readonly probeUndiscoveredDocumentsBatch: (
    input: InitialDocumentProbeBatchInput,
  ) => Promise<InitialDocumentProbeBatchResult>;
  readonly reportInitialDocumentProbeComplete: (requestedCount: number) => void;
}

export interface InitialDocumentProbe {
  readonly arm: (eligibleContainerIds: ReadonlyArray<string>) => void;
  /** Accept a completed full discovery listing only in the current probe session. */
  readonly captureListing: (
    containerId: string,
  ) => (documentIds: ReadonlyArray<string>) => void;
  readonly canRun: () => boolean;
  readonly continuationDelayMs: () => number;
  readonly hasPendingWork: () => boolean;
  readonly resetPending: () => void;
  readonly resetSkippedListings: () => void;
  readonly run: () => Promise<void>;
}

const MAX_INITIAL_DOCUMENT_LISTING_ATTEMPTS = 3;
/** Lanes one unit lists together: one listing request's worth. */
const INITIAL_DOCUMENT_LISTING_BATCH_SIZE = MAX_CONTAINER_DOCUMENT_LANES;
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

/**
 * Eligible containers still awaiting an authoritative listing, each with the
 * earliest time its bounded retry backoff allows another attempt (0 = now).
 */
function unlistedContainerRetries(
  state: InitialDocumentProbeState,
): Array<{ containerId: string; notBeforeMs: number }> {
  return [...state.eligibleContainerIds]
    .filter((id) => !state.listedDocumentIdsByContainer.has(id))
    .map((id) => ({
      containerId: id,
      notBeforeMs: state.listingRetryNotBeforeByContainer.get(id) ?? 0,
    }));
}

function canRun(state: InitialDocumentProbeState, nowMs: number): boolean {
  if (!state.armed || state.running || !hasPendingWork(state)) {
    return false;
  }
  const retries = unlistedContainerRetries(state);
  return (
    retries.length === 0 || retries.some((retry) => retry.notBeforeMs <= nowMs)
  );
}

function continuationDelayMs(
  state: InitialDocumentProbeState,
  nowMs: number,
): number {
  const retries = unlistedContainerRetries(state);
  if (
    retries.length === 0 ||
    retries.some((retry) => retry.notBeforeMs <= nowMs)
  ) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(...retries.map((retry) => retry.notBeforeMs)) - nowMs,
  );
}

/**
 * Invalidate the listing session: bump the generation, drop the candidate
 * cursor and merged listing set, and clear listing retry bookkeeping.
 * Per-container listing/probe results survive unless the caller clears them.
 */
function resetListingSession(state: InitialDocumentProbeState): void {
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

function resetPending(state: InitialDocumentProbeState): void {
  resetListingSession(state);
  state.eligibleContainerIds.clear();
  state.listedDocumentIdsByContainer.clear();
  state.probedContainerIds.clear();
}

function resetSkippedListings(state: InitialDocumentProbeState): void {
  if (state.skippedContainerIds.size === 0) {
    return;
  }
  // A reconnect is a new opportunity for lanes that exhausted their bounded
  // listing retries. Preserve completed healthy lanes, but invalidate any
  // candidate cursor because the authoritative listing set can now grow.
  resetListingSession(state);
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

/** Counts one failed listing of `containerId` and schedules its retry. */
function recordListingFailure(
  host: InitialDocumentProbeHost,
  state: InitialDocumentProbeState,
  containerId: string,
): void {
  const attempts = (state.listingAttemptsByContainer.get(containerId) ?? 0) + 1;
  state.listingAttemptsByContainer.set(containerId, attempts);
  // Retry transient listing failures with bounded, seconds-scale backoff.
  // Exhausted lanes are skipped until prerequisites are regained so healthy
  // lanes can converge without suppressing the failed lane forever.
  if (attempts >= MAX_INITIAL_DOCUMENT_LISTING_ATTEMPTS) {
    state.skippedContainerIds.add(containerId);
    state.eligibleContainerIds.delete(containerId);
    state.listingAttemptsByContainer.delete(containerId);
    state.listingRetryNotBeforeByContainer.delete(containerId);
    return;
  }
  const retryDelayMs =
    INITIAL_DOCUMENT_LISTING_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1);
  state.listingRetryNotBeforeByContainer.set(
    containerId,
    host.clock.now() + retryDelayMs,
  );
}

/**
 * Lists the next batch of eligible containers still awaiting an
 * authoritative listing, in one request. Returns whether a batch was due.
 */
async function listNextEligibleContainers(input: {
  readonly eligibleIds: ReadonlyArray<string>;
  readonly host: InitialDocumentProbeHost;
  readonly runGeneration: number;
  readonly state: InitialDocumentProbeState;
}): Promise<boolean> {
  const { eligibleIds, host, runGeneration, state } = input;
  const nowMs = host.clock.now();
  const containerIds = eligibleIds
    .filter(
      (id) =>
        !state.listedDocumentIdsByContainer.has(id) &&
        (state.listingRetryNotBeforeByContainer.get(id) ?? 0) <= nowMs,
    )
    .slice(0, INITIAL_DOCUMENT_LISTING_BATCH_SIZE);
  if (containerIds.length === 0) {
    return false;
  }

  let listed: ReadonlyMap<string, ReadonlyArray<string> | null>;
  try {
    listed = await host.listContainerDocumentIds(containerIds);
  } catch {
    listed = new Map();
  }
  if (state.generation !== runGeneration) {
    return true;
  }
  for (const containerId of containerIds) {
    const documentIds = listed.get(containerId) ?? null;
    if (documentIds === null) {
      recordListingFailure(host, state, containerId);
      continue;
    }
    state.listingAttemptsByContainer.delete(containerId);
    state.listingRetryNotBeforeByContainer.delete(containerId);
    state.listedDocumentIdsByContainer.set(containerId, new Set(documentIds));
  }
  return true;
}

async function runProbe(
  host: InitialDocumentProbeHost,
  state: InitialDocumentProbeState,
): Promise<void> {
  if (!canRun(state, host.clock.now())) {
    return;
  }

  state.running = true;
  const runGeneration = state.generation;
  try {
    const eligibleIds = [...state.eligibleContainerIds];
    if (
      await listNextEligibleContainers({
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
    if (!batch.done && batch.nextCursor !== null) {
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
 * Runs one bounded unit per call: first one batched authoritative listing of
 * up to a request's worth of containers, then one local candidate batch.
 * Incremental discovery watermarks are never used as evidence that a document
 * is absent from the server.
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
    captureListing: (containerId) => {
      // Early active-container discovery may precede arming; a later probe
      // deliberately re-reads when it cannot reuse this session's listing.
      const generation = state.generation;
      return (documentIds) => {
        if (
          state.generation !== generation ||
          !state.armed ||
          !state.eligibleContainerIds.has(containerId) ||
          state.listedDocumentIdsByContainer.has(containerId)
        ) {
          return;
        }
        state.listedDocumentIdsByContainer.set(
          containerId,
          new Set(documentIds),
        );
        state.listedDocumentIds = null;
        state.listingAttemptsByContainer.delete(containerId);
        state.listingRetryNotBeforeByContainer.delete(containerId);
      };
    },
    canRun: () => canRun(state, host.clock.now()),
    continuationDelayMs: () => continuationDelayMs(state, host.clock.now()),
    hasPendingWork: () => state.armed && hasPendingWork(state),
    resetPending: () => resetPending(state),
    resetSkippedListings: () => resetSkippedListings(state),
    run: () => runProbe(host, state),
  };
}
