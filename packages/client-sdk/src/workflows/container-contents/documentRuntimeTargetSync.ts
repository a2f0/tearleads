import type {
  ContainerContentsDocumentRuntimeTarget,
  ContainerDocumentPrimeHost,
  ContainerDocumentProbeHost,
} from "./documentQueries/types";

// Stores opened per macrotask. Opening is fire-and-forget, so yielding between
// chunks keeps the main thread and serialized SQLite queue responsive while a
// restored replica schedules a real backlog.
const DOCUMENT_STORE_OPEN_CHUNK_SIZE = 8;

async function requestRuntimeTargetSync<TRuntime, TStore>(input: {
  readonly host: {
    documentWorkflowRuntime: (containerId: string | null) => TRuntime;
    openDocumentStore: (input: {
      documentId: string | null;
      localId: string;
      runtime: TRuntime;
    }) => TStore;
  };
  readonly requestStoreSync: (store: TStore) => void;
  readonly targets: ReadonlyArray<ContainerContentsDocumentRuntimeTarget>;
}): Promise<ReadonlySet<string>> {
  const requestedLocalIds = new Set<string>();
  const runtimesByContainerId = new Map<string | null, TRuntime>();

  for (const target of input.targets) {
    if (requestedLocalIds.has(target.localId)) {
      continue;
    }
    if (
      requestedLocalIds.size > 0 &&
      requestedLocalIds.size % DOCUMENT_STORE_OPEN_CHUNK_SIZE === 0
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    let runtime = runtimesByContainerId.get(target.runtimeContainerId);
    if (runtime === undefined) {
      runtime = input.host.documentWorkflowRuntime(target.runtimeContainerId);
      runtimesByContainerId.set(target.runtimeContainerId, runtime);
    }

    const store = input.host.openDocumentStore({
      documentId: target.documentId,
      localId: target.localId,
      runtime,
    });
    requestedLocalIds.add(target.localId);
    input.requestStoreSync(store);
  }

  return requestedLocalIds;
}

export function requestDocumentRuntimeTargetSync<TRuntime>(input: {
  readonly host: ContainerDocumentPrimeHost<TRuntime>;
  readonly targets: ReadonlyArray<ContainerContentsDocumentRuntimeTarget>;
}): Promise<ReadonlySet<string>> {
  return requestRuntimeTargetSync({
    ...input,
    requestStoreSync: (store) => {
      if (store.getSnapshot?.().ready ?? true) {
        store.requestSync();
      }
    },
  });
}

export function requestRemoteDocumentRuntimeTargetSync<TRuntime>(input: {
  readonly host: ContainerDocumentProbeHost<TRuntime>;
  readonly targets: ReadonlyArray<ContainerContentsDocumentRuntimeTarget>;
}): Promise<ReadonlySet<string>> {
  return requestRuntimeTargetSync({
    ...input,
    // Unlike ordinary startup priming, a probe must survive a freshly opened
    // store's initialization. requestRemoteSync records that intent before
    // scheduling, so the first ready pass performs an HTTP revalidation.
    requestStoreSync: (store) => store.requestRemoteSync(),
  });
}
