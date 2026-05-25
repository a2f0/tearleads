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
  initialDocumentKind = DEFAULT_DOCUMENT_KIND,
  initialText = "",
}: DocumentsProviderProps) {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const runtime = useMemo<DocumentsRuntime>(
    () =>
      containerId === undefined
        ? tearleads.documents.runtime()
        : tearleads.documents.runtime(containerId),
    [appData, containerId, tearleads],
  );
  const store = useMemo(
    () =>
      tearleads.documents.store(
        {
          containerId,
          documentId,
          initialDocumentKind,
          initialText,
          localId,
        },
        runtime,
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

  const snapshot = useTearleadsExternalStoreSnapshot(store);

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
