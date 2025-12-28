import {
  CreateMLCEngine,
  type InitProgressReport,
  type MLCEngine
} from '@mlc-ai/web-llm';
import { useCallback, useRef, useState } from 'react';

export interface LoadProgress {
  text: string;
  progress: number;
}

export interface LLMState {
  engine: MLCEngine | null;
  loadedModel: string | null;
  isLoading: boolean;
  loadProgress: LoadProgress | null;
  error: string | null;
}

export interface UseLLMReturn extends LLMState {
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  isWebGPUSupported: () => Promise<boolean>;
}

// Singleton engine reference to ensure only one model is loaded at a time
let globalEngine: MLCEngine | null = null;
let globalLoadedModel: string | null = null;

export function useLLM(): UseLLMReturn {
  const [engine, setEngine] = useState<MLCEngine | null>(globalEngine);
  const [loadedModel, setLoadedModel] = useState<string | null>(
    globalLoadedModel
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track current loading operation to handle cancellation
  const loadingModelRef = useRef<string | null>(null);

  const isWebGPUSupported = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === 'undefined') return false;
    if (!('gpu' in navigator)) return false;

    try {
      // Cast to any for WebGPU API which may not be in TS types
      const gpu = (
        navigator as { gpu?: { requestAdapter: () => Promise<unknown> } }
      ).gpu;
      if (!gpu) return false;
      const adapter = await gpu.requestAdapter();
      return adapter !== null;
    } catch {
      return false;
    }
  }, []);

  const unloadModel = useCallback(async () => {
    if (globalEngine) {
      try {
        await globalEngine.unload();
      } catch (err) {
        console.error('Error unloading model:', err);
      }
      globalEngine = null;
      globalLoadedModel = null;
      setEngine(null);
      setLoadedModel(null);
    }
    setError(null);
    setLoadProgress(null);
  }, []);

  const loadModel = useCallback(
    async (modelId: string) => {
      // Don't reload if already loaded
      if (globalLoadedModel === modelId && globalEngine) {
        setEngine(globalEngine);
        setLoadedModel(globalLoadedModel);
        return;
      }

      // Check WebGPU support
      const supported = await isWebGPUSupported();
      if (!supported) {
        setError(
          'WebGPU is not supported in this browser. Please use Chrome 113+ or Edge 113+.'
        );
        return;
      }

      setIsLoading(true);
      setError(null);
      setLoadProgress({ text: 'Initializing...', progress: 0 });
      loadingModelRef.current = modelId;

      try {
        // Unload previous model if any
        await unloadModel();

        const progressCallback = (progress: InitProgressReport) => {
          // Only update if this is still the model we're loading
          if (loadingModelRef.current === modelId) {
            setLoadProgress({
              text: progress.text,
              progress: progress.progress
            });
          }
        };

        const newEngine = await CreateMLCEngine(modelId, {
          initProgressCallback: progressCallback
        });

        // Verify we're still loading this model (not cancelled)
        if (loadingModelRef.current === modelId) {
          globalEngine = newEngine;
          globalLoadedModel = modelId;
          setEngine(newEngine);
          setLoadedModel(modelId);
          setLoadProgress(null);
        } else {
          // User started loading a different model, unload this one
          await newEngine.unload();
        }
      } catch (err) {
        if (loadingModelRef.current === modelId) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Failed to load model: ${message}`);
          setLoadProgress(null);
        }
      } finally {
        if (loadingModelRef.current === modelId) {
          setIsLoading(false);
          loadingModelRef.current = null;
        }
      }
    },
    [isWebGPUSupported, unloadModel]
  );

  return {
    engine,
    loadedModel,
    isLoading,
    loadProgress,
    error,
    loadModel,
    unloadModel,
    isWebGPUSupported
  };
}
