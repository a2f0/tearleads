function readListedDocumentId(value: unknown): string | null {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return null;
  }
  const documentId = Reflect.get(value, "documentId");
  return typeof documentId === "string" ? documentId : null;
}

export interface InitialDocumentProbeHost {
  readonly canDiscoverContainerDocuments: (containerId: string) => boolean;
  readonly listKnownContainerIds: () => ReadonlyArray<string>;
  readonly probeUndiscoveredDocuments?: (
    listedDocumentIds: ReadonlySet<string>,
  ) => Promise<void>;
}

export interface InitialDocumentProbe {
  readonly arm: () => void;
  readonly canRun: () => boolean;
  readonly recordListing: (
    containerId: string,
    listedDocuments: unknown,
  ) => void;
  readonly resetPending: () => void;
  readonly run: () => Promise<void>;
}

/**
 * Tracks the first complete background document-listing sweep for a replica.
 * The controller deliberately records the API discovery result, not the local
 * projection loaded afterward: a stale local row missing from the server list
 * is exactly the document the resulting probe must revalidate.
 */
export function createInitialDocumentProbe(
  host: InitialDocumentProbeHost,
): InitialDocumentProbe {
  const completedContainerIds = new Set<string>();
  const listedDocumentIds = new Set<string>();
  let armed = false;
  let complete = false;
  let running = false;

  const canRun = () => {
    if (!armed || complete || running || !host.probeUndiscoveredDocuments) {
      return false;
    }

    return host
      .listKnownContainerIds()
      .filter(host.canDiscoverContainerDocuments)
      .every((containerId) => completedContainerIds.has(containerId));
  };

  return {
    arm: () => {
      if (!complete) {
        armed = true;
      }
    },
    canRun,
    recordListing: (containerId, listedDocuments) => {
      if (complete || listedDocuments === null) {
        return;
      }

      completedContainerIds.add(containerId);
      if (!Array.isArray(listedDocuments)) {
        return;
      }
      for (const listedDocument of listedDocuments) {
        const documentId = readListedDocumentId(listedDocument);
        if (documentId) {
          listedDocumentIds.add(documentId);
        }
      }
    },
    resetPending: () => {
      if (complete) {
        return;
      }
      armed = false;
      completedContainerIds.clear();
      listedDocumentIds.clear();
    },
    run: async () => {
      if (!canRun() || !host.probeUndiscoveredDocuments) {
        return;
      }

      running = true;
      try {
        await host.probeUndiscoveredDocuments(new Set(listedDocumentIds));
        complete = true;
      } finally {
        running = false;
      }
    },
  };
}
