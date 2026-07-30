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
  readonly canDiscoverContainerDocuments: (containerId: string) => boolean;
  readonly listKnownContainerIds: () => ReadonlyArray<string>;
  readonly listContainerDocumentIds: (
    containerId: string,
  ) => Promise<ReadonlyArray<string> | null>;
  readonly probeUndiscoveredDocumentsBatch: (
    input: InitialDocumentProbeBatchInput,
  ) => Promise<InitialDocumentProbeBatchResult>;
  readonly reportInitialDocumentProbeComplete: (requestedCount: number) => void;
}

export interface InitialDocumentProbe {
  readonly arm: () => void;
  readonly canRun: () => boolean;
  readonly resetPending: () => void;
  readonly run: () => Promise<void>;
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

/**
 * Runs one bounded unit per call: first one authoritative container listing,
 * then one local candidate batch. Incremental discovery watermarks are never
 * used as evidence that a document is absent from the server.
 */
export function createInitialDocumentProbe(
  host: InitialDocumentProbeHost,
): InitialDocumentProbe {
  const listedDocumentIdsByContainer = new Map<string, ReadonlySet<string>>();
  let armed = false;
  let complete = false;
  let cursor: string | null = null;
  let generation = 0;
  let requestedCount = 0;
  let running = false;

  const eligibleContainerIds = () =>
    Array.from(new Set(host.listKnownContainerIds())).filter(
      host.canDiscoverContainerDocuments,
    );

  const canRun = () => armed && !complete && !running;

  const resetPending = () => {
    if (complete) {
      return;
    }
    generation += 1;
    armed = false;
    cursor = null;
    requestedCount = 0;
    listedDocumentIdsByContainer.clear();
  };

  const listNextEligibleContainer = async (
    eligibleIds: ReadonlyArray<string>,
    runGeneration: number,
  ): Promise<boolean> => {
    const containerId = eligibleIds.find(
      (id) => !listedDocumentIdsByContainer.has(id),
    );
    if (!containerId) {
      return false;
    }

    const documentIds = await host.listContainerDocumentIds(containerId);
    if (generation !== runGeneration) {
      return true;
    }
    if (documentIds === null) {
      // A later idle-backfill signal retries without hot-looping the lane.
      armed = false;
      return true;
    }
    listedDocumentIdsByContainer.set(containerId, new Set(documentIds));
    return true;
  };

  return {
    arm: () => {
      if (!complete) {
        armed = true;
      }
    },
    canRun,
    resetPending,
    run: async () => {
      if (!canRun()) {
        return;
      }

      running = true;
      const runGeneration = generation;
      try {
        const eligibleIds = eligibleContainerIds();
        if (await listNextEligibleContainer(eligibleIds, runGeneration)) {
          return;
        }

        const listedDocumentIds = new Set(
          eligibleIds.flatMap((containerId) => [
            ...(listedDocumentIdsByContainer.get(containerId) ?? []),
          ]),
        );
        const batch = await host.probeUndiscoveredDocumentsBatch({
          afterLocalId: cursor,
          listedContainerIds: new Set(eligibleIds),
          listedDocumentIds,
        });
        if (generation !== runGeneration) {
          return;
        }

        cursor = batch.nextCursor;
        requestedCount += batch.requestedCount;
        if (batch.done) {
          armed = false;
          complete = true;
          host.reportInitialDocumentProbeComplete(requestedCount);
        }
      } finally {
        running = false;
      }
    },
  };
}
