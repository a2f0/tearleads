import type {
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { primeDocumentStore } from "../documents/DocumentsProvider";
import type { ExplorerDocumentReadModel } from "./documentReadModel";
import {
  createExplorerDocumentsRuntime,
  type ExplorerDocumentsRuntimeAppData,
} from "./documentRuntime";

const EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE = 8;
const EXPLORER_DROPPED_FILE_MAX_BYTES = 5 * 1024 * 1024;
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
  labels: ExplorerDroppedFileImportLabels;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  logError?: (message: string, cause?: unknown) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  onProgress?: (progress: ExplorerDroppedFileImportProgress) => void;
}

export interface ExplorerDroppedFileImportLabels {
  fileImportStoreNotReady: string;
  getFileImportFailureLog: (fileName: string) => string;
  getFileTooLargeError: (input: {
    fileName: string;
    maxByteLength: number;
  }) => string;
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

function assertExplorerDroppedFileCanBeImported(
  file: File,
  labels: ExplorerDroppedFileImportLabels,
): void {
  if (file.size > EXPLORER_DROPPED_FILE_MAX_BYTES) {
    throw new Error(
      labels.getFileTooLargeError({
        fileName: file.name,
        maxByteLength: EXPLORER_DROPPED_FILE_MAX_BYTES,
      }),
    );
  }
}

async function importExplorerDroppedFile<TRuntime>(input: {
  containerId: string;
  createDocumentStore: ExplorerDroppedFileImportInput<TRuntime>["createDocumentStore"];
  createLocalId: () => string;
  file: File;
  labels: ExplorerDroppedFileImportLabels;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  runtime: TRuntime;
}): Promise<DocumentSummary> {
  assertExplorerDroppedFileCanBeImported(input.file, input.labels);
  const localId = input.createLocalId();
  const text = await input.file.text();
  const store = input.createDocumentStore({
    initialText: text,
    localId,
    runtime: input.runtime,
  });
  const initialized = await store.ensureInitialized();
  if (!initialized) {
    throw new Error(input.labels.fileImportStoreNotReady);
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
          labels: input.labels,
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
          input.labels.getFileImportFailureLog(
            batch[batchIndex]?.name ?? "file",
          ),
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
  labels: ExplorerDroppedFileImportLabels;
  logError: (message: string, cause?: unknown) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
}): ImportExplorerDroppedFiles {
  const { appData, documentReadModel, labels, logError, mergeDocumentSummary } =
    params;

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
        labels,
        loadDocumentSummary: documentReadModel.loadDocumentSummary,
        logError,
        mergeDocumentSummary,
        ...(onProgress === undefined ? {} : { onProgress }),
      }),
    [appData, documentReadModel, labels, logError, mergeDocumentSummary],
  );
}
