import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../providers/data/AppDataProvider";
import { createDocumentsWorkflowRuntime } from "../../workflows/documents";
import { getOrCreateDocumentStore } from "./documentStore";
import {
  DEFAULT_DOCUMENT_ID,
  type DocumentContextValue,
  type DocumentStore,
  type DocumentsRuntime,
} from "./types";

export {
  createDocumentStore,
  primeDocumentStore,
  requestDomainDocumentSync,
  subscribeToPersistedDocuments,
} from "./documentStore";
export type {
  DocumentAttachmentStatus,
  DocumentContextValue,
  DocumentsRuntime,
} from "./types";
export { DEFAULT_DOCUMENT_ID } from "./types";

const DocumentContext = createContext<DocumentStore | null>(null);

interface DocumentsProviderProps extends PropsWithChildren {
  localId?: string;
  containerId?: string | null;
  documentId?: string | null;
  initialText?: string;
}

export function DocumentsProvider({
  children,
  localId = DEFAULT_DOCUMENT_ID,
  containerId,
  documentId = null,
  initialText = "",
}: DocumentsProviderProps) {
  const appData = useAppData();
  const runtime = useMemo<DocumentsRuntime>(
    () =>
      createDocumentsWorkflowRuntime({
        ...appData,
        containerId:
          containerId === undefined ? appData.containerId : containerId,
      }),
    [appData, containerId],
  );
  const store = useMemo(
    () =>
      getOrCreateDocumentStore(
        runtime.domainScope,
        localId,
        runtime,
        documentId,
        initialText,
      ),
    [documentId, initialText, localId, runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useEffect(() => {
    store.requestSync();
  }, [
    runtime.encapsulationKeyPair,
    runtime.isAuthenticated,
    runtime.online,
    runtime.organizationId,
    runtime.signingFingerprint,
    runtime.signingKeyPair,
    store,
    runtime.userId,
  ]);

  return (
    <DocumentContext.Provider value={store}>
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocument(): DocumentContextValue {
  const store = useContext(DocumentContext);
  if (!store) {
    throw new Error("useDocument must be used within a DocumentsProvider.");
  }

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo(
    () => ({
      attachments: snapshot.attachments,
      attachmentStatusBySlotId: snapshot.attachmentStatusBySlotId,
      attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
      attachFiles: store.attachFiles,
      canAttach: snapshot.canAttach,
      documentId: snapshot.documentId,
      ready: snapshot.ready,
      setAttachment: store.setAttachment,
      replaceAttachment: store.replaceAttachment,
      text: snapshot.text,
      syncing: snapshot.syncing,
      setText: store.setText,
    }),
    [snapshot, store],
  );
}
