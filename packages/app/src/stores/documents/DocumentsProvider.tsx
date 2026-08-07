import {
  DEFAULT_DOCUMENT_ID,
  DEFAULT_DOCUMENT_KIND,
  type DocumentContextValue,
  type DocumentStore,
  type DocumentsRuntime,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../providers/sdk/useTearleadsSubscription";

export { DEFAULT_DOCUMENT_ID };

const DocumentContext = createContext<DocumentStore | null>(null);

// A host-forced read-only flag, kept out of the SDK document snapshot because it
// is a UI concern (e.g. the document lives in the Trash) rather than an
// access-plane permission. It folds into canWrite/canAttach in useDocument so
// every editor goes read-only, and is exposed via useDocumentReadOnly so chrome
// (edit buttons) can be hidden rather than merely disabled. Defaults to false,
// so consumers that never pass `readOnly` are unaffected.
const DocumentReadOnlyContext = createContext<boolean>(false);

interface DocumentsProviderProps extends PropsWithChildren {
  localId?: string;
  containerId?: string | null;
  documentId?: string | null;
  initialDocumentKind?: StoredDocumentKind;
  initialText?: string;
  readOnly?: boolean | undefined;
}

export function DocumentsProvider({
  children,
  localId = DEFAULT_DOCUMENT_ID,
  containerId,
  documentId = null,
  initialDocumentKind = DEFAULT_DOCUMENT_KIND,
  initialText = "",
  readOnly = false,
}: DocumentsProviderProps) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo<DocumentsRuntime>(
    () =>
      containerId === undefined
        ? tearleads.documents.workflowRuntime()
        : tearleads.documents.workflowRuntime(containerId),
    [appData, containerId, tearleads],
  );
  const store = useMemo(
    () =>
      tearleads.documents.open(
        {
          containerId,
          documentId,
          initialDocumentKind,
          initialText,
          localId,
        },
        { workflowRuntime: runtime },
      ),
    [
      containerId,
      documentId,
      initialDocumentKind,
      initialText,
      localId,
      runtime,
      tearleads,
    ],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useEffect(() => {
    store.requestSync();
  }, [
    runtime.auth.isAuthenticated,
    runtime.auth.organizationId,
    runtime.auth.userId,
    runtime.crypto.encapsulationKeyPair,
    runtime.crypto.signingFingerprint,
    runtime.crypto.signingKeyPair,
    runtime.state.online,
    store,
  ]);

  return (
    <DocumentContext.Provider value={store}>
      <DocumentReadOnlyContext.Provider value={readOnly}>
        {children}
      </DocumentReadOnlyContext.Provider>
    </DocumentContext.Provider>
  );
}

// Whether the host has forced this document read-only (e.g. it is in the Trash),
// independent of access-plane write permission. Components use this to hide edit
// chrome entirely; the read-only rendering itself is already handled by the
// canWrite/canAttach fold in useDocument.
export function useDocumentReadOnly(): boolean {
  return useContext(DocumentReadOnlyContext);
}

export function useDocument(): DocumentContextValue {
  const store = useContext(DocumentContext);
  if (!store) {
    throw new Error("useDocument must be used within a DocumentsProvider.");
  }

  const snapshot = useTearleadsExternalStoreSnapshot(store);
  const readOnly = useContext(DocumentReadOnlyContext);

  return useMemo(
    () => ({
      ...store,
      ...snapshot,
      // Fold the host read-only flag into both write gates so every editor and
      // attachment control (which all derive from these two booleans) goes
      // read-only for a trashed document even though the viewer still owns it.
      canAttach: snapshot.canAttach && !readOnly,
      canWrite: snapshot.canWrite && !readOnly,
    }),
    [snapshot, store, readOnly],
  );
}
