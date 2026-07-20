import type {
  ContainerDocumentLinks,
  ContainerDocumentQueries,
  DocumentAttachmentUpload,
  DocumentSummary,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { getDocumentFileImporter } from "../../document-types/importers";

const EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE = 8;

interface ExplorerDroppedFileDocumentStore {
  addRow: (fields: Readonly<Record<string, string>>) => Promise<string>;
  attachFiles: (
    files: ReadonlyArray<DocumentAttachmentUpload>,
  ) => Promise<void> | void;
  getSnapshot: () => {
    documentId: string | null;
    documentKind: StoredDocumentKind;
    ready: boolean;
    title: string;
  };
  requestSync: () => void;
  setStructuredFields: (
    kind: Exclude<StoredDocumentKind, "note">,
    patch: Readonly<Record<string, string | undefined>>,
  ) => Promise<void>;
  setText: (value: string) => Promise<void>;
}

export interface ExplorerDroppedFileImportProgress {
  completedCount: number;
  failedCount: number;
  importedCount: number;
  totalCount: number;
}

export interface ExplorerDroppedFileImportResult
  extends ExplorerDroppedFileImportProgress {
  // True when the run's signal aborted before every file was attempted; the
  // files already imported stay (they are durable documents, not rolled back).
  aborted: boolean;
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
  deferRequestSync?: boolean;
  files: ReadonlyArray<File>;
  labels: ExplorerDroppedFileImportLabels;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  logError?: (message: string, cause?: unknown) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
  onFileFailed?: (fileIndex: number, error: unknown) => void;
  onFileImported?: (input: {
    fileIndex: number;
    localId: string;
    requestSync: () => void;
  }) => void;
  onFileStart?: (fileIndex: number) => void;
  onProgress?: (progress: ExplorerDroppedFileImportProgress) => void;
  signal?: AbortSignal;
}

export interface ExplorerDroppedFileImportLabels {
  fileImportStoreNotReady: string;
  getFileImportFailureLog: (fileName: string) => string;
  getFileTooLargeError: (input: {
    fileName: string;
    maxByteLength: number;
  }) => string;
}

export interface ExplorerDroppedFileImportRunOptions {
  // Skip the per-file store.requestSync(): the caller kicks sync itself once
  // the run settles, so ingest and sync stop contending for the database's
  // single serialized queue. The onFileImported callback carries the deferred
  // requestSync for each imported file.
  deferRequestSync?: boolean;
  onFileFailed?: (fileIndex: number, error: unknown) => void;
  onFileImported?: (input: {
    fileIndex: number;
    localId: string;
    requestSync: () => void;
  }) => void;
  onFileStart?: (fileIndex: number) => void;
  onProgress?: (progress: ExplorerDroppedFileImportProgress) => void;
  // Cancels between batches, never mid-file: the batch in flight settles, then
  // no further batch starts (mirrors PurgeOptions' unit-boundary semantics).
  signal?: AbortSignal;
}

export type ImportExplorerDroppedFiles = (
  containerId: string,
  files: ReadonlyArray<File>,
  options?: ExplorerDroppedFileImportRunOptions,
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
  deferRequestSync: boolean;
  file: File;
  fileIndex: number;
  labels: ExplorerDroppedFileImportLabels;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  onFileImported: ExplorerDroppedFileImportInput["onFileImported"];
  onFileStart: ExplorerDroppedFileImportInput["onFileStart"];
}): Promise<DocumentSummary> {
  input.onFileStart?.(input.fileIndex);
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
  await store.setText(importedFile.initialText);
  if (!store.getSnapshot().ready) {
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
  for (const row of importedFile.rows ?? []) {
    await store.addRow(row);
  }
  if (importedFile.attachment) {
    await store.attachFiles([importedFile.attachment]);
  }
  if (!input.deferRequestSync) {
    store.requestSync();
  }
  // Hand the deferred sync kick over BEFORE the summary load: the document is
  // already durable at this point, so even if the summary query rejects (and
  // the file is counted failed), its sync must not be lost.
  input.onFileImported?.({
    fileIndex: input.fileIndex,
    localId,
    requestSync: () => store.requestSync(),
  });

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

  // True only when the signal actually cut files from the run — a cancel that
  // lands while the final batch settles changes nothing and stays un-aborted.
  let aborted = false;
  for (
    let index = 0;
    index < files.length;
    index += EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE
  ) {
    if (input.signal?.aborted) {
      aborted = true;
      break;
    }

    const batch = files.slice(
      index,
      index + EXPLORER_DROPPED_FILE_IMPORT_BATCH_SIZE,
    );
    const batchResults = await Promise.allSettled(
      batch.map((file, batchIndex) =>
        importExplorerDroppedFile({
          containerId: input.containerId,
          createDocumentStore: input.createDocumentStore,
          createLocalId: input.createLocalId,
          deferRequestSync: input.deferRequestSync ?? false,
          file,
          fileIndex: index + batchIndex,
          labels: input.labels,
          loadDocumentSummary: input.loadDocumentSummary,
          onFileImported: input.onFileImported,
          onFileStart: input.onFileStart,
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
        input.onFileFailed?.(index + batchIndex, result.reason);
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
    aborted,
    importedDocuments,
  };
}

export function useExplorerDroppedFileImport(params: {
  appData: ContainerDocumentLinks;
  documentQueries: ContainerDocumentQueries;
  labels: ExplorerDroppedFileImportLabels;
  logError: (message: string, cause?: unknown) => void;
  mergeDocumentSummary: (nextDocument: DocumentSummary) => void;
}): ImportExplorerDroppedFiles {
  const { appData, documentQueries, labels, logError, mergeDocumentSummary } =
    params;

  return useCallback(
    (containerId, files, options) =>
      importExplorerDroppedFiles({
        containerId,
        createDocumentStore: ({
          containerId: targetContainerId,
          initialDocumentKind,
          initialText,
          localId,
        }) =>
          appData.openDocument({
            containerId: targetContainerId,
            initialDocumentKind,
            initialText,
            localId,
          }),
        createLocalId: () => crypto.randomUUID(),
        files,
        labels,
        loadDocumentSummary: documentQueries.loadDocumentSummary,
        logError,
        mergeDocumentSummary,
        ...(options?.deferRequestSync === undefined
          ? {}
          : { deferRequestSync: options.deferRequestSync }),
        ...(options?.onFileFailed === undefined
          ? {}
          : { onFileFailed: options.onFileFailed }),
        ...(options?.onFileImported === undefined
          ? {}
          : { onFileImported: options.onFileImported }),
        ...(options?.onFileStart === undefined
          ? {}
          : { onFileStart: options.onFileStart }),
        ...(options?.onProgress === undefined
          ? {}
          : { onProgress: options.onProgress }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }),
    [appData, documentQueries, labels, logError, mergeDocumentSummary],
  );
}
