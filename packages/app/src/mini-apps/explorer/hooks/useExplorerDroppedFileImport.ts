import { useCallback } from "react";
import type { DocumentSummary } from "../../../data/documentSummary";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import { primeDocumentStore } from "../../../stores/documents/DocumentsProvider";
import type { ExplorerDocumentReadModel } from "../../../stores/explorer/documentReadModel";
import {
  createExplorerDocumentsRuntime,
  type ExplorerDocumentsRuntimeAppData,
} from "../../../stores/explorer/documentRuntime";

const EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE = 8;
type ExplorerDroppedFileImportRuntime = ReturnType<
  typeof createExplorerDocumentsRuntime
>;

interface ExplorerDroppedFileDocumentStore {
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => {
    documentId: string | null;
    documentKind: StoredDocumentKind;
    title: string;
  };
  requestSync: () => void;
}

export interface ExplorerDroppedFileImportProgress {
  completedCount: number;
  failedCount: number;
  importedCount: number;
  totalCount: number;
}

export interface ExplorerDroppedFileImportResult
  extends ExplorerDroppedFileImportProgress {
  importedDocuments: ReadonlyArray<DocumentSummary>;
}

interface ExplorerDroppedFileImportStoreInput<TRuntime> {
  initialText: string;
  localId: string;
  runtime: TRuntime;
}

interface ExplorerDroppedFileImportInput<TRuntime> {
  containerId: string;
  createDocumentRuntime: (containerId: string) => TRuntime;
  createDocumentStore: (
    input: ExplorerDroppedFileImportStoreInput<TRuntime>,
  ) => ExplorerDroppedFileDocumentStore;
  createLocalId: () => string;
  files: ReadonlyArray<File>;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  logError?: (message: string, cause?: unknown) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  onProgress?: (progress: ExplorerDroppedFileImportProgress) => void;
}

export type ImportExplorerDroppedFiles = (
  containerId: string,
  files: ReadonlyArray<File>,
  onProgress?: (progress: ExplorerDroppedFileImportProgress) => void,
) => Promise<ExplorerDroppedFileImportResult>;

function buildFallbackImportedDocumentSummary(input: {
  containerId: string;
  localId: string;
  store: ExplorerDroppedFileDocumentStore;
}): DocumentSummary {
  const snapshot = input.store.getSnapshot();

  return {
    id: input.localId,
    containerId: input.containerId,
    documentId: snapshot.documentId,
    documentKind: snapshot.documentKind,
    title: snapshot.title,
    updatedAt: new Date().toISOString(),
  };
}

async function importExplorerDroppedFile<TRuntime>(input: {
  containerId: string;
  createDocumentStore: ExplorerDroppedFileImportInput<TRuntime>["createDocumentStore"];
  createLocalId: () => string;
  file: File;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  runtime: TRuntime;
}): Promise<DocumentSummary> {
  const localId = input.createLocalId();
  const text = await input.file.text();
  const store = input.createDocumentStore({
    initialText: text,
    localId,
    runtime: input.runtime,
  });
  const initialized = await store.ensureInitialized();
  if (!initialized) {
    throw new Error("Document store was not ready.");
  }

  store.requestSync();

  return (
    (await input.loadDocumentSummary(localId)) ??
    buildFallbackImportedDocumentSummary({
      containerId: input.containerId,
      localId,
      store,
    })
  );
}

function emitProgress(
  input: Pick<ExplorerDroppedFileImportInput<unknown>, "onProgress">,
  progress: ExplorerDroppedFileImportProgress,
) {
  input.onProgress?.({ ...progress });
}

export async function importExplorerDroppedFiles<TRuntime>(
  input: ExplorerDroppedFileImportInput<TRuntime>,
): Promise<ExplorerDroppedFileImportResult> {
  const files = Array.from(input.files);
  const runtime = input.createDocumentRuntime(input.containerId);
  const importedDocuments: DocumentSummary[] = [];
  const progress: ExplorerDroppedFileImportProgress = {
    completedCount: 0,
    failedCount: 0,
    importedCount: 0,
    totalCount: files.length,
  };
  emitProgress(input, progress);

  for (
    let index = 0;
    index < files.length;
    index += EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE
  ) {
    const batch = files.slice(
      index,
      index + EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE,
    );
    const batchResults = await Promise.allSettled(
      batch.map((file) =>
        importExplorerDroppedFile({
          containerId: input.containerId,
          createDocumentStore: input.createDocumentStore,
          createLocalId: input.createLocalId,
          file,
          loadDocumentSummary: input.loadDocumentSummary,
          runtime,
        }),
      ),
    );

    for (const [batchIndex, result] of batchResults.entries()) {
      progress.completedCount += 1;
      if (result.status === "fulfilled") {
        progress.importedCount += 1;
        importedDocuments.push(result.value);
        input.mergeDocumentSummary(result.value);
      } else {
        progress.failedCount += 1;
        input.logError?.(
          `Explorer: failed to import ${batch[batchIndex]?.name ?? "file"}.`,
          result.reason,
        );
      }
      emitProgress(input, progress);
    }
  }

  return {
    ...progress,
    importedDocuments,
  };
}

export function useExplorerDroppedFileImport(params: {
  appData: ExplorerDocumentsRuntimeAppData;
  documentReadModel: ExplorerDocumentReadModel;
  logError: (message: string, cause?: unknown) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
}): ImportExplorerDroppedFiles {
  const { appData, documentReadModel, logError, mergeDocumentSummary } = params;

  return useCallback(
    (containerId, files, onProgress) =>
      importExplorerDroppedFiles<ExplorerDroppedFileImportRuntime>({
        containerId,
        createDocumentRuntime: (targetContainerId) =>
          createExplorerDocumentsRuntime(appData, targetContainerId),
        createDocumentStore: ({ initialText, localId, runtime }) =>
          primeDocumentStore(
            appData.domainScope,
            localId,
            runtime,
            null,
            initialText,
            "note",
          ),
        createLocalId: () => crypto.randomUUID(),
        files,
        loadDocumentSummary: documentReadModel.loadDocumentSummary,
        logError,
        mergeDocumentSummary,
        ...(onProgress === undefined ? {} : { onProgress }),
      }),
    [appData, documentReadModel, logError, mergeDocumentSummary],
  );
}
