import type { BlobInfo } from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DocumentBlobOpenProvider,
  type DocumentBlobOpenRequest,
} from "../../../document-types/shared/DocumentBlobOpenContext";
import {
  DocumentBlobPickProvider,
  type DocumentBlobPickRequest,
} from "../../../document-types/shared/DocumentBlobPickContext";

// A "pick" routes a document's "Choose Blob" action over to the Explorer's
// blob-browser panel (pick mode) and carries the chosen blob back to the
// document. The target lives in React state rather than the URL: picking a blob
// for a slot is an in-session interaction, not a deep-linkable destination.
export interface ExplorerBlobPickTarget {
  containerId: string;
  // localId of the document the pick returns to once a blob is chosen.
  localId: string;
  slotId: string;
  slotLabel: string;
}

interface ExplorerBlobPickResult {
  blob: BlobInfo;
  localId: string;
  slotId: string;
}

// Explorer-facing handles: the detail panel reads pickTarget to render pick
// mode, and resolves/cancels the active pick. Document types never see these —
// they use the document-types-owned DocumentBlobPickContext instead.
interface ExplorerBlobPickContextValue {
  cancelBlobPick: () => void;
  pickTarget: ExplorerBlobPickTarget | null;
  resolveBlobPick: (blob: BlobInfo) => void;
}

const ExplorerBlobPickContext =
  createContext<ExplorerBlobPickContextValue | null>(null);

export function ExplorerBlobPickProvider(
  params: PropsWithChildren<{
    // Navigates the Explorer detail panel to the blob-browser route. Called
    // when a pick starts; clearing the target on resolve/cancel routes back.
    openBlobBrowserRoute: (input?: DocumentBlobOpenRequest | undefined) => void;
    returnToDocumentRoute: (localId: string, containerId: string) => void;
  }>,
) {
  const { children, openBlobBrowserRoute, returnToDocumentRoute } = params;
  const [pickTarget, setPickTarget] = useState<ExplorerBlobPickTarget | null>(
    null,
  );
  // The picked result is one-shot and read on the next render of the document,
  // so a ref avoids an extra state update / re-render race with the route swap.
  const resultRef = useRef<ExplorerBlobPickResult | null>(null);

  const requestBlobPick = useCallback(
    (request: DocumentBlobPickRequest) => {
      resultRef.current = null;
      setPickTarget({
        containerId: request.containerId,
        localId: request.localId,
        slotId: request.slot.slotId,
        slotLabel: request.slot.label,
      });
      openBlobBrowserRoute();
    },
    [openBlobBrowserRoute],
  );
  const openBlob = useCallback(
    (request: DocumentBlobOpenRequest) => {
      openBlobBrowserRoute(request);
    },
    [openBlobBrowserRoute],
  );

  const resolveBlobPick = useCallback(
    (blob: BlobInfo) => {
      setPickTarget((target) => {
        if (target) {
          resultRef.current = {
            blob,
            localId: target.localId,
            slotId: target.slotId,
          };
          returnToDocumentRoute(target.localId, target.containerId);
        }
        return null;
      });
    },
    [returnToDocumentRoute],
  );

  const cancelBlobPick = useCallback(() => {
    setPickTarget((target) => {
      if (target) {
        returnToDocumentRoute(target.localId, target.containerId);
      }
      return null;
    });
  }, [returnToDocumentRoute]);

  const consumeBlobPick = useCallback(
    (localId: string, slotId: string): BlobInfo | null => {
      const result = resultRef.current;
      if (!result || result.localId !== localId || result.slotId !== slotId) {
        return null;
      }
      resultRef.current = null;
      return result.blob;
    },
    [],
  );

  const explorerValue = useMemo<ExplorerBlobPickContextValue>(
    () => ({ cancelBlobPick, pickTarget, resolveBlobPick }),
    [cancelBlobPick, pickTarget, resolveBlobPick],
  );
  const documentValue = useMemo(
    () => ({ consumeBlobPick, requestBlobPick }),
    [consumeBlobPick, requestBlobPick],
  );
  const documentOpenValue = useMemo(() => ({ openBlob }), [openBlob]);

  return (
    <ExplorerBlobPickContext.Provider value={explorerValue}>
      <DocumentBlobOpenProvider value={documentOpenValue}>
        <DocumentBlobPickProvider value={documentValue}>
          {children}
        </DocumentBlobPickProvider>
      </DocumentBlobOpenProvider>
    </ExplorerBlobPickContext.Provider>
  );
}

export function useExplorerBlobPick(): ExplorerBlobPickContextValue {
  const context = useContext(ExplorerBlobPickContext);
  if (!context) {
    throw new Error("useExplorerBlobPick requires ExplorerBlobPickProvider");
  }
  return context;
}
