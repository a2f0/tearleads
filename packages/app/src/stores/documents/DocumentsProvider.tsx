import type { StoredDocumentKind } from "@tearleads/client-sdk";
import {
  DEFAULT_DOCUMENT_ID,
  type DocumentContextValue,
  type DocumentStore,
  type DocumentsRuntime,
  getOrCreateDocumentStore,
} from "@tearleads/client-sdk/stores/documents";
import { createDocumentsWorkflowRuntime } from "@tearleads/client-sdk/workflows/documents";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../providers/data/AppDataProvider";

export type {
  DocumentAttachmentStatus,
  DocumentsRuntime,
} from "@tearleads/client-sdk/stores/documents";
export {
  createDocumentStore,
  DEFAULT_DOCUMENT_ID,
  primeDocumentStore,
  requestDomainDocumentSync,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk/stores/documents";

const DocumentContext = createContext<DocumentStore | null>(null);

interface DocumentsProviderProps extends PropsWithChildren {
  localId?: string;
  containerId?: string | null;
  documentId?: string | null;
  initialDocumentKind?: StoredDocumentKind;
  initialText?: string;
}

export function DocumentsProvider({
  children,
  localId = DEFAULT_DOCUMENT_ID,
  containerId,
  documentId = null,
  initialDocumentKind = "note",
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
        initialDocumentKind,
      ),
    [
      documentId,
      initialDocumentKind,
      initialText,
      localId,
      runtime.domainScope,
    ],
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
      documentKind: snapshot.documentKind,
      fieldValidationIssues: snapshot.fieldValidationIssues,
      ready: snapshot.ready,
      requestSync: store.requestSync,
      setAttachment: store.setAttachment,
      replaceAttachment: store.replaceAttachment,
      setStructuredFields: store.setStructuredFields,
      structuredFields: snapshot.structuredFields,
      text: snapshot.text,
      title: snapshot.title,
      syncing: snapshot.syncing,
      setText: store.setText,
    }),
    [snapshot, store],
  );
}
