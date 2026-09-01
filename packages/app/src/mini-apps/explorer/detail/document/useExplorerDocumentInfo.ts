import type { DocumentInfo } from "@tearleads/client-sdk";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

interface DocumentInfoGeneration {
  readonly load: (localId: string) => Promise<DocumentInfo>;
  readonly localId: string;
}

interface ActiveDocumentInfoRequest extends DocumentInfoGeneration {
  valid: boolean;
}

interface LoadedDocumentInfo {
  readonly info: DocumentInfo;
  readonly localId: string;
}

interface LoadedDocumentInfoError {
  readonly localId: string;
  readonly message: string;
}

/**
 * Serialize refresh generations for one routed document. A generation change
 * invalidates the active response immediately, but waits for that request to
 * settle before issuing one trailing request with the latest loader. Navigating
 * to another document supersedes the old lane and starts immediately.
 */
export function useExplorerDocumentInfo(input: DocumentInfoGeneration) {
  const activeRef = useRef<ActiveDocumentInfoRequest | null>(null);
  const mountedRef = useRef(false);
  const trailingRef = useRef<DocumentInfoGeneration | null>(null);
  const [loaded, setLoaded] = useState<LoadedDocumentInfo | null>(null);
  const [loadedError, setLoadedError] =
    useState<LoadedDocumentInfoError | null>(null);
  const [isLoadingDocumentInfo, setIsLoadingDocumentInfo] = useState(false);

  const launch = useCallback(function launch(
    generation: DocumentInfoGeneration,
  ) {
    const active: ActiveDocumentInfoRequest = { ...generation, valid: true };
    activeRef.current = active;
    setIsLoadingDocumentInfo(true);
    setLoadedError(null);

    void Promise.resolve()
      .then(() => generation.load(generation.localId))
      .then((info) => {
        if (
          mountedRef.current &&
          activeRef.current === active &&
          active.valid
        ) {
          setLoaded({ info, localId: generation.localId });
        }
      })
      .catch((error: unknown) => {
        if (
          mountedRef.current &&
          activeRef.current === active &&
          active.valid
        ) {
          setLoadedError({
            localId: generation.localId,
            message: unknownErrorMessage(error),
          });
        }
      })
      .finally(() => {
        if (activeRef.current !== active) {
          return;
        }
        const trailing = trailingRef.current;
        trailingRef.current = null;
        if (trailing?.localId === active.localId) {
          launch(trailing);
          return;
        }
        activeRef.current = null;
        if (mountedRef.current) {
          setIsLoadingDocumentInfo(false);
        }
      });
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Invalidate a superseded request before paint so its resolution cannot
  // briefly render between the freshness render and passive-effect flushing.
  useLayoutEffect(() => {
    const next = { load: input.load, localId: input.localId };
    const active = activeRef.current;
    if (!active) {
      launch(next);
      return;
    }
    if (active.localId !== next.localId) {
      active.valid = false;
      trailingRef.current = null;
      launch(next);
      return;
    }
    if (
      (active.valid && active.load === next.load) ||
      trailingRef.current?.load === next.load
    ) {
      return;
    }
    active.valid = false;
    trailingRef.current = next;
    setLoadedError(null);
  }, [input.load, input.localId, launch]);

  const documentInfo = loaded?.localId === input.localId ? loaded.info : null;
  const documentInfoError =
    loadedError?.localId === input.localId ? loadedError.message : null;
  return { documentInfo, documentInfoError, isLoadingDocumentInfo };
}
