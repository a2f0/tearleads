import type {
  ContainerDocumentLinksRuntime,
  ContainerDocumentReadModel,
  DocumentAttachmentUpload,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { getDocumentFileImporter } from "../../document-types/importers";

const EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE = 8;

interface ExplorerDroppedFileDocumentStore {
  attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) => void;
  ensureInitialized: () => Promise<boolean>;
  getSnapshot: () => {
    documentId: string | null;
    documentKind: StoredDocumentKind;
    title: string;
  };
  requestSync: () => void;
  setStructuredFields: (
    kind: Exclude<StoredDocumentKind, "note">,
    patch: Readonly<Record<string, string | undefined>>,
  ) => Promise<void>;
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

interface ExplorerDroppedFileImportStoreInput {
  containerId: string;
  initialDocumentKind: StoredDocumentKind;
  initialText: string;
  localId: string;
}

interface ExplorerDroppedFileImportInput {
  containerId: string;
  createDocumentStore: (
    input: ExplorerDroppedFileImportStoreInput,
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
  maxByteLength: number,
): void {
  if (file.size > maxByteLength) {
    throw new Error(
      labels.getFileTooLargeError({
        fileName: file.name,
        maxByteLength,
      }),
    );
  }
}

async function importExplorerDroppedFile(input: {
  containerId: string;
  createDocumentStore: ExplorerDroppedFileImportInput["createDocumentStore"];
  createLocalId: () => string;
  file: File;
  labels: ExplorerDroppedFileImportLabels;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
}): Promise<DocumentSummary> {
  const importer = getDocumentFileImporter(input.file);
  assertExplorerDroppedFileCanBeImported(
    input.file,
    input.labels,
    importer.maxByteLength,
  );
  const localId = input.createLocalId();
  const importedFile = await importer.importFile(input.file);
  const store = input.createDocumentStore({
    containerId: input.containerId,
    initialDocumentKind: importedFile.documentKind,
    initialText: importedFile.initialText,
    localId,
  });
  const initialized = await store.ensureInitialized();
  if (!initialized) {
    throw new Error(input.labels.fileImportStoreNotReady);
  }

  if (
    importedFile.documentKind !== "note" &&
    Object.keys(importedFile.structuredFields).length > 0
  ) {
    await store.setStructuredFields(
      importedFile.documentKind,
      importedFile.structuredFields,
    );
  }
  if (importedFile.attachment) {
    store.attachFiles([importedFile.attachment]);
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
  input: Pick<ExplorerDroppedFileImportInput, "onProgress">,
  progress: ExplorerDroppedFileImportProgress,
) {
  input.onProgress?.({ ...progress });
}

export async function importExplorerDroppedFiles(
  input: ExplorerDroppedFileImportInput,
): Promise<ExplorerDroppedFileImportResult> {
  const files = Array.from(input.files);
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
  appData: ContainerDocumentLinksRuntime;
  documentReadModel: ContainerDocumentReadModel;
  labels: ExplorerDroppedFileImportLabels;
  logError: (message: string, cause?: unknown) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
}): ImportExplorerDroppedFiles {
  const { appData, documentReadModel, labels, logError, mergeDocumentSummary } =
    params;

  return useCallback(
    (containerId, files, onProgress) =>
      importExplorerDroppedFiles({
        containerId,
        createDocumentStore: ({
          containerId: targetContainerId,
          initialDocumentKind,
          initialText,
          localId,
        }) =>
          appData.primeDocumentStore({
            containerId: targetContainerId,
            initialDocumentKind,
            initialText,
            localId,
          }),
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
