// component-complexity: allow -- provider coordinates persisted queue, runner lifecycle, and waiter resolution in one place.
import { isOpenRouterModelId } from '@tearleads/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useLLM } from '@/hooks/ai';

const ACTIVE_MODEL_DOWNLOAD_KEY = 'tearleads:model-download:active-model-id';
const MODEL_DOWNLOAD_QUEUE_KEY = 'tearleads:model-download:queue';

interface ModelDownloadManagerContextValue {
  downloadingModelId: string | null;
  queuedModelIds: string[];
  isDownloading: boolean;
  downloadProgress: ReturnType<typeof useLLM>['loadProgress'];
  downloadModel: (modelId: string) => Promise<void>;
}

const ModelDownloadManagerContext =
  createContext<ModelDownloadManagerContextValue | null>(null);

interface ModelDownloadManagerProviderProps {
  children: ReactNode;
}

interface InFlightDownload {
  modelId: string;
  promise: Promise<void>;
}

interface JobWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

function readPersistedActiveDownloadModelId(): string | null {
  try {
    const value = localStorage.getItem(ACTIVE_MODEL_DOWNLOAD_KEY);
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

function persistActiveDownloadModelId(modelId: string | null): void {
  try {
    if (modelId) {
      localStorage.setItem(ACTIVE_MODEL_DOWNLOAD_KEY, modelId);
      return;
    }
    localStorage.removeItem(ACTIVE_MODEL_DOWNLOAD_KEY);
  } catch {
    // Ignore storage errors (e.g., private mode / quota)
  }
}

function readPersistedQueueModelIds(): string[] {
  try {
    const raw = localStorage.getItem(MODEL_DOWNLOAD_QUEUE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0
    );
  } catch {
    return [];
  }
}

function persistQueueModelIds(modelIds: string[]): void {
  try {
    if (modelIds.length === 0) {
      localStorage.removeItem(MODEL_DOWNLOAD_QUEUE_KEY);
      return;
    }
    localStorage.setItem(MODEL_DOWNLOAD_QUEUE_KEY, JSON.stringify(modelIds));
  } catch {
    // Ignore storage errors (e.g., private mode / quota)
  }
}

function getInitialQueueModelIds(): string[] {
  const persistedQueue = readPersistedQueueModelIds().filter(
    (modelId) => !isOpenRouterModelId(modelId)
  );
  const activeModelId = readPersistedActiveDownloadModelId();

  if (!activeModelId || isOpenRouterModelId(activeModelId)) {
    persistActiveDownloadModelId(null);
    return persistedQueue;
  }

  const queueWithoutActive = persistedQueue.filter(
    (id) => id !== activeModelId
  );
  return [activeModelId, ...queueWithoutActive];
}

export function ModelDownloadManagerProvider({
  children
}: ModelDownloadManagerProviderProps) {
  const llm = useLLM();
  const { loadModel, loadedModel, isLoading, loadProgress } = llm;
  const [queueModelIds, setQueueModelIds] = useState<string[]>(
    getInitialQueueModelIds
  );
  const queueModelIdsRef = useRef<string[]>(queueModelIds);
  const [runningModelId, setRunningModelId] = useState<string | null>(null);
  const runningModelIdRef = useRef<string | null>(runningModelId);
  const processingRef = useRef(false);
  const inFlightDownloadRef = useRef<InFlightDownload | null>(null);
  const jobWaitersRef = useRef<Map<string, JobWaiter[]>>(new Map());

  useEffect(() => {
    queueModelIdsRef.current = queueModelIds;
  }, [queueModelIds]);

  useEffect(() => {
    runningModelIdRef.current = runningModelId;
  }, [runningModelId]);

  const appendJobWaiter = useCallback((modelId: string): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const current = jobWaitersRef.current.get(modelId) ?? [];
      current.push({ resolve, reject });
      jobWaitersRef.current.set(modelId, current);
    });
  }, []);

  const settleJobWaiters = useCallback((modelId: string, error?: unknown) => {
    const waiters = jobWaitersRef.current.get(modelId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    jobWaitersRef.current.delete(modelId);

    if (!error) {
      for (const waiter of waiters) {
        waiter.resolve();
      }
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Model download failed';
    const rejectionError = new Error(message);
    for (const waiter of waiters) {
      waiter.reject(rejectionError);
    }
  }, []);

  const enqueueModelId = useCallback((modelId: string) => {
    const isRunning = runningModelIdRef.current === modelId;
    const isQueued = queueModelIdsRef.current.includes(modelId);
    if (isRunning || isQueued) {
      return;
    }

    const nextQueue = [...queueModelIdsRef.current, modelId];
    queueModelIdsRef.current = nextQueue;
    setQueueModelIds(nextQueue);
    persistQueueModelIds(nextQueue);
  }, []);

  const dequeueNextModelId = useCallback((): string | null => {
    if (queueModelIdsRef.current.length === 0) {
      return null;
    }

    const nextModelId = queueModelIdsRef.current[0] ?? null;
    const remainingQueue = queueModelIdsRef.current.slice(1);
    queueModelIdsRef.current = remainingQueue;
    setQueueModelIds(remainingQueue);
    persistQueueModelIds(remainingQueue);
    return nextModelId;
  }, []);

  const runQueue = useCallback(async () => {
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;
    try {
      while (true) {
        if (isLoading && runningModelIdRef.current === null) {
          break;
        }

        const nextModelId = dequeueNextModelId();
        if (!nextModelId) {
          break;
        }

        setRunningModelId(nextModelId);
        runningModelIdRef.current = nextModelId;
        persistActiveDownloadModelId(nextModelId);

        const promise = loadModel(nextModelId);
        inFlightDownloadRef.current = { modelId: nextModelId, promise };

        try {
          await promise;
          settleJobWaiters(nextModelId);
        } catch (error) {
          settleJobWaiters(nextModelId, error);
        } finally {
          if (inFlightDownloadRef.current?.modelId === nextModelId) {
            inFlightDownloadRef.current = null;
          }
          setRunningModelId(null);
          runningModelIdRef.current = null;
          persistActiveDownloadModelId(null);
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [dequeueNextModelId, isLoading, loadModel, settleJobWaiters]);

  // Resume interrupted queue after reload/navigation.
  useEffect(() => {
    if (queueModelIdsRef.current.length === 0) {
      persistActiveDownloadModelId(null);
      return;
    }
    void runQueue();
  }, [runQueue]);

  const downloadModel = useCallback(
    async (modelId: string): Promise<void> => {
      if (isOpenRouterModelId(modelId)) {
        await loadModel(modelId);
        return;
      }

      if (
        loadedModel === modelId &&
        !isLoading &&
        runningModelIdRef.current === null
      ) {
        return;
      }

      if (inFlightDownloadRef.current?.modelId === modelId) {
        return inFlightDownloadRef.current.promise;
      }

      const promise = appendJobWaiter(modelId);
      enqueueModelId(modelId);
      void runQueue();
      return promise;
    },
    [
      appendJobWaiter,
      enqueueModelId,
      isLoading,
      loadModel,
      loadedModel,
      runQueue
    ]
  );

  const queuedModelIds = useMemo(() => {
    if (!runningModelId) {
      return queueModelIds;
    }
    return queueModelIds.filter((modelId) => modelId !== runningModelId);
  }, [queueModelIds, runningModelId]);

  const value = useMemo<ModelDownloadManagerContextValue>(
    () => ({
      downloadingModelId: runningModelId,
      queuedModelIds,
      isDownloading: runningModelId !== null,
      downloadProgress: runningModelId ? loadProgress : null,
      downloadModel
    }),
    [downloadModel, loadProgress, queuedModelIds, runningModelId]
  );

  return (
    <ModelDownloadManagerContext.Provider value={value}>
      {children}
    </ModelDownloadManagerContext.Provider>
  );
}

export function useModelDownloadManager(): ModelDownloadManagerContextValue {
  const context = useContext(ModelDownloadManagerContext);
  if (!context) {
    throw new Error(
      'useModelDownloadManager must be used within ModelDownloadManagerProvider'
    );
  }
  return context;
}
