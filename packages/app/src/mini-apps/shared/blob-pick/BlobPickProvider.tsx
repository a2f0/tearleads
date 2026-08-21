import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
} from "@symcrypt/client-sdk";
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

// Shared mini-app host for the document-types blob-pick seam. A "pick" routes a
// document's "Choose Blob" action over to the host mini-app's blob-browser panel
// (pick mode) and carries the chosen blob back to the document. The target lives
// in React state rather than the URL: picking a blob for a slot is an in-session
// interaction, not a deep-linkable destination. Any mini-app that renders a
// blob-browser surface can mount this provider (currently the Explorer) so it
// need not be imported across mini-app boundaries.
export interface BlobPickTarget {
  containerId: string;
  // localId of the document the pick returns to once a blob is chosen.
  localId: string;
  slotId: string;
  slotLabel: string;
}

interface BlobPickResult {
  blob: BlobInfo;
  localId: string;
  slotId: string;
}

// Host-facing handles: the mini-app's blob-browser panel reads pickTarget to
// render pick mode, and resolves/cancels the active pick. Document types never
// see these — they use the document-types-owned DocumentBlobPickContext instead.
interface BlobPickContextValue {
  cancelBlobPick: () => void;
  pickTarget: BlobPickTarget | null;
  resolveBlobPick: (blob: BlobInfo) => void;
}

const BlobPickContext = createContext<BlobPickContextValue | null>(null);

export function BlobPickProvider(
  params: PropsWithChildren<{
    // Lists every blob in the identity-local projection, across organizations;
    // used to hide "Choose Blob" only when that global picker would be empty.
    loadBlobInfo: (query?: BlobInfoInput | undefined) => Promise<BlobInfoList>;
    // Navigates the host's detail surface to the blob-browser route. Called when
    // a pick starts; clearing the target on resolve/cancel routes back. Optional:
    // a host that derives the picker's visibility directly from `pickTarget`
    // (e.g. the Notes mini-app, which swaps the editor for the picker) needs no
    // routing and can omit both callbacks.
    openBlobBrowserRoute?:
      | ((input?: DocumentBlobOpenRequest | undefined) => void)
      | undefined;
    returnToDocumentRoute?:
      | ((localId: string, containerId: string) => void)
      | undefined;
  }>,
) {
  const {
    children,
    loadBlobInfo,
    openBlobBrowserRoute,
    returnToDocumentRoute,
  } = params;
  const [pickTarget, setPickTarget] = useState<BlobPickTarget | null>(null);
  // The picked result is one-shot and read on the next render of the document,
  // so a ref avoids an extra state update / re-render race with the route swap.
  const resultRef = useRef<BlobPickResult | null>(null);

  const requestBlobPick = useCallback(
    (request: DocumentBlobPickRequest) => {
      resultRef.current = null;
      setPickTarget({
        containerId: request.containerId,
        localId: request.localId,
        slotId: request.slot.slotId,
        slotLabel: request.slot.label,
      });
      openBlobBrowserRoute?.();
    },
    [openBlobBrowserRoute],
  );
  const openBlob = useCallback(
    (request: DocumentBlobOpenRequest) => {
      openBlobBrowserRoute?.(request);
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
          returnToDocumentRoute?.(target.localId, target.containerId);
        }
        return null;
      });
    },
    [returnToDocumentRoute],
  );

  const cancelBlobPick = useCallback(() => {
    setPickTarget((target) => {
      if (target) {
        returnToDocumentRoute?.(target.localId, target.containerId);
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

  // Only the total is needed, so cap the page at one row.
  const loadPickableBlobCount = useCallback(
    async () => (await loadBlobInfo({ limit: 1 })).totalCount,
    [loadBlobInfo],
  );

  const hostValue = useMemo<BlobPickContextValue>(
    () => ({ cancelBlobPick, pickTarget, resolveBlobPick }),
    [cancelBlobPick, pickTarget, resolveBlobPick],
  );
  const documentValue = useMemo(
    () => ({ consumeBlobPick, loadPickableBlobCount, requestBlobPick }),
    [consumeBlobPick, loadPickableBlobCount, requestBlobPick],
  );
  const documentOpenValue = useMemo(() => ({ openBlob }), [openBlob]);

  return (
    <BlobPickContext.Provider value={hostValue}>
      <DocumentBlobOpenProvider value={documentOpenValue}>
        <DocumentBlobPickProvider value={documentValue}>
          {children}
        </DocumentBlobPickProvider>
      </DocumentBlobOpenProvider>
    </BlobPickContext.Provider>
  );
}

export function useBlobPick(): BlobPickContextValue {
  const context = useContext(BlobPickContext);
  if (!context) {
    throw new Error("useBlobPick requires BlobPickProvider");
  }
  return context;
}
