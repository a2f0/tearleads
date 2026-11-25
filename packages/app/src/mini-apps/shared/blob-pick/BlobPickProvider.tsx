import type {
  BlobInfo,
  BlobInfoInput,
  BlobInfoList,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
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
import { getAttachmentSlotAccept } from "../../../document-types/shared/documentAttachmentUtils";
import {
  type BlobPickEvent,
  type BlobPickTarget,
  blobPickTarget,
  IDLE_BLOB_PICK,
  transitionBlobPick,
} from "./blobPickMachine";

export type { BlobPickTarget } from "./blobPickMachine";

// Shared mini-app host for the document-types blob-pick seam. A "pick" routes a
// document's "Choose Blob" action over to the host mini-app's blob-browser panel
// (pick mode) and carries the chosen blob back to the document. The target lives
// in React state rather than the URL: picking a blob for a slot is an in-session
// interaction, not a deep-linkable destination. Any mini-app that renders a
// blob-browser surface can mount this provider (currently the Explorer) so it
// need not be imported across mini-app boundaries. The pick's lifecycle is the
// machine in blobPickMachine.ts; this provider runs its navigation.

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

interface BlobPickRouting {
  // Navigates the host's detail surface to the blob-browser route. Called when
  // a pick starts; resolve/cancel route back. Optional: a host that derives
  // the picker's visibility directly from `pickTarget` (e.g. the Notes
  // mini-app, which swaps the editor for the picker) needs no routing and can
  // omit these.
  openBlobBrowserRoute?:
    | ((input?: DocumentBlobOpenRequest | undefined) => void)
    | undefined;
  // Whether the host's route shows the blob browser right now. A host that
  // routes the picker passes it: the target is held until the return
  // navigation leaves that route, and leaving it mid-pick abandons the pick.
  pickerRouteActive?: boolean | undefined;
  returnToDocumentRoute?:
    | ((localId: string, containerId: string) => void)
    | undefined;
}

// Runs one pick at a time through blobPickMachine: request, then resolve or
// cancel, each with its navigation, and the one-shot result the document reads.
function useBlobPickLifecycle(routing: BlobPickRouting) {
  const { openBlobBrowserRoute, returnToDocumentRoute } = routing;
  const pickerRouteActive = routing.pickerRouteActive === true;
  const [pick, setPick] = useState(IDLE_BLOB_PICK);
  // Read by the callbacks below, so a second resolve or cancel in the same
  // tick already sees the pick as finished and does not navigate twice.
  const pickRef = useRef(pick);
  const send = useCallback((event: BlobPickEvent) => {
    pickRef.current = transitionBlobPick(pickRef.current, event);
    setPick(pickRef.current);
  }, []);
  // The picked result is one-shot and read on the next render of the document,
  // so a ref avoids an extra state update / re-render race with the route swap.
  const resultRef = useRef<BlobPickResult | null>(null);

  const wasPickerRouteActive = useRef(pickerRouteActive);
  useEffect(() => {
    if (wasPickerRouteActive.current && !pickerRouteActive) {
      send({ type: "picker-route-left" });
    }
    wasPickerRouteActive.current = pickerRouteActive;
  }, [pickerRouteActive, send]);

  const requestBlobPick = useCallback(
    (request: DocumentBlobPickRequest) => {
      resultRef.current = null;
      send({
        type: "requested",
        target: {
          containerId: request.containerId,
          localId: request.localId,
          slotAccept: getAttachmentSlotAccept(request.slot),
          slotId: request.slot.slotId,
          slotLabel: request.slot.label,
        },
      });
      openBlobBrowserRoute?.();
    },
    [openBlobBrowserRoute, send],
  );

  // Ends the pick in progress, with the chosen blob or (null) without one, and
  // routes back to its document.
  const finishBlobPick = useCallback(
    (blob: BlobInfo | null) => {
      const current = pickRef.current;
      if (current.status !== "picking") {
        return;
      }
      const { target } = current;
      if (blob) {
        resultRef.current = {
          blob,
          localId: target.localId,
          slotId: target.slotId,
        };
      }
      send({ type: "finished", awaitsRoute: pickerRouteActive });
      returnToDocumentRoute?.(target.localId, target.containerId);
    },
    [pickerRouteActive, returnToDocumentRoute, send],
  );
  const resolveBlobPick = useCallback(
    (blob: BlobInfo) => finishBlobPick(blob),
    [finishBlobPick],
  );
  const cancelBlobPick = useCallback(
    () => finishBlobPick(null),
    [finishBlobPick],
  );

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

  return {
    cancelBlobPick,
    consumeBlobPick,
    pickTarget: blobPickTarget(pick),
    requestBlobPick,
    resolveBlobPick,
  };
}

export function BlobPickProvider(
  params: PropsWithChildren<
    BlobPickRouting & {
      // Lists every blob in the identity-local projection, across
      // organizations; used to hide "Choose Blob" only when that global picker
      // would be empty.
      loadBlobInfo: (
        query?: BlobInfoInput | undefined,
      ) => Promise<BlobInfoList>;
    }
  >,
) {
  const { children, loadBlobInfo, openBlobBrowserRoute } = params;
  const {
    cancelBlobPick,
    consumeBlobPick,
    pickTarget,
    requestBlobPick,
    resolveBlobPick,
  } = useBlobPickLifecycle(params);
  const openBlob = useCallback(
    (request: DocumentBlobOpenRequest) => {
      openBlobBrowserRoute?.(request);
    },
    [openBlobBrowserRoute],
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
