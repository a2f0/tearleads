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

interface ModelDownloadManagerContextValue {
  downloadingModelId: string | null;
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

function readPersistedDownloadModelId(): string | null {
  try {
    const value = localStorage.getItem(ACTIVE_MODEL_DOWNLOAD_KEY);
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

function persistDownloadModelId(modelId: string | null): void {
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

export function ModelDownloadManagerProvider({
  children
}: ModelDownloadManagerProviderProps) {
  const llm = useLLM();
  const { loadModel, loadedModel, isLoading, loadProgress } = llm;
  const [activeDownloadModelId, setActiveDownloadModelId] = useState<
    string | null
  >(() => readPersistedDownloadModelId());
  const inFlightDownloadRef = useRef<InFlightDownload | null>(null);

  const clearActiveDownload = useCallback((modelId: string) => {
    if (inFlightDownloadRef.current?.modelId === modelId) {
      inFlightDownloadRef.current = null;
    }
    setActiveDownloadModelId((currentModelId) => {
      if (currentModelId !== modelId) {
        return currentModelId;
      }
      persistDownloadModelId(null);
      return null;
    });
  }, []);

  const downloadModel = useCallback(
    async (modelId: string): Promise<void> => {
      if (isOpenRouterModelId(modelId)) {
        await loadModel(modelId);
        return;
      }

      const inFlightDownload = inFlightDownloadRef.current;
      if (inFlightDownload && inFlightDownload.modelId === modelId) {
        return inFlightDownload.promise;
      }

      setActiveDownloadModelId(modelId);
      persistDownloadModelId(modelId);

      const promise = (async () => {
        try {
          await loadModel(modelId);
        } finally {
          clearActiveDownload(modelId);
        }
      })();

      inFlightDownloadRef.current = { modelId, promise };
      return promise;
    },
    [clearActiveDownload, loadModel]
  );

  // Resume an interrupted local-model download on app startup.
  useEffect(() => {
    const persistedModelId = readPersistedDownloadModelId();
    if (!persistedModelId || isOpenRouterModelId(persistedModelId)) {
      persistDownloadModelId(null);
      return;
    }

    if (loadedModel === persistedModelId || isLoading) {
      return;
    }

    void downloadModel(persistedModelId);
  }, [downloadModel, isLoading, loadedModel]);

  // Keep storage in sync if model was loaded outside this provider's job API.
  useEffect(() => {
    if (!activeDownloadModelId) {
      return;
    }
    if (loadedModel !== activeDownloadModelId || isLoading) {
      return;
    }
    clearActiveDownload(activeDownloadModelId);
  }, [activeDownloadModelId, clearActiveDownload, isLoading, loadedModel]);

  const value = useMemo<ModelDownloadManagerContextValue>(
    () => ({
      downloadingModelId: isLoading ? activeDownloadModelId : null,
      isDownloading: isLoading && activeDownloadModelId !== null,
      downloadProgress: isLoading ? loadProgress : null,
      downloadModel
    }),
    [activeDownloadModelId, downloadModel, isLoading, loadProgress]
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
