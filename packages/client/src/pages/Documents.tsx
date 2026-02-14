import { and, desc, eq, like, or } from 'drizzle-orm';
import {
  FileText,
  Info,
  Loader2,
  RotateCcw,
  Trash2,
  Upload
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { RefreshButton } from '@/components/ui/refresh-button';
import { UploadProgress } from '@/components/ui/upload-progress';
import { getDatabase } from '@/db';
import { getKeyManager } from '@/db/crypto';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useTypedTranslation } from '@/i18n';
import { objectUrlToDataUrl } from '@/lib/chat-attachments';
import { retrieveFileData } from '@/lib/data-retrieval';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { setAttachedImage } from '@/lib/llm-runtime';
import { useNavigateWithFrom } from '@/lib/navigation';
import {
  getFileStorage,
  initializeFileStorage,
  isFileStorageInitialized
} from '@/storage/opfs';
import { DocumentsListView } from './documents/DocumentsListView';
import { DocumentsTableView } from './documents/DocumentsTableView';
import type { DocumentInfo, DocumentWithUrl } from './documents/documentTypes';

const PDF_MIME_TYPE = 'application/pdf';

type ViewMode = 'list' | 'table';

interface DocumentsProps {
  showBackLink?: boolean;
  onSelectDocument?: (documentId: string) => void;
  refreshToken?: number;
  viewMode?: ViewMode;
  showDeleted?: boolean;
  showDropzone?: boolean;
  onUpload?: () => void;
  onOpenAIChat?: () => void;
}

export function Documents({
  showBackLink = true,
  onSelectDocument,
  refreshToken,
  viewMode = 'list',
  showDeleted = false,
  showDropzone = true,
  onUpload,
  onOpenAIChat
}: DocumentsProps) {
  const navigateWithFrom = useNavigateWithFrom();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const [documents, setDocuments] = useState<DocumentWithUrl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    document: DocumentWithUrl;
    x: number;
    y: number;
  } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [blankSpaceMenu, setBlankSpaceMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();
  const fetchedForInstanceRef = useRef<string | null>(null);

  const isTableView = viewMode === 'table';

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(
    async (document: DocumentWithUrl, e?: React.MouseEvent) => {
      e?.stopPropagation();

      try {
        if (!currentInstanceId) throw new Error('No active instance');
        const data = await retrieveFileData(
          document.storagePath,
          currentInstanceId
        );
        downloadFile(data, document.name);
      } catch (err) {
        console.error('Failed to download document:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId]
  );

  const handleShare = useCallback(
    async (document: DocumentWithUrl, e?: React.MouseEvent) => {
      e?.stopPropagation();

      try {
        if (!currentInstanceId) throw new Error('No active instance');
        const data = await retrieveFileData(
          document.storagePath,
          currentInstanceId
        );
        await shareFile(data, document.name, document.mimeType);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to share document:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentInstanceId]
  );

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      const isDocumentType = (type: string) =>
        type === PDF_MIME_TYPE || type.startsWith('text/');
      const validFiles = selectedFiles.filter((file) =>
        isDocumentType(file.type)
      );
      const invalidFileErrors = selectedFiles
        .filter((file) => !isDocumentType(file.type))
        .map((file) => `"${file.name}" is not a supported document type.`);

      const errors: string[] = [...invalidFileErrors];
      const progresses = Array(validFiles.length).fill(0);
      let uploadedCount = 0;

      const updateOverallProgress = () => {
        if (validFiles.length === 0) return;
        const totalProgress = progresses.reduce((sum, p) => sum + p, 0);
        setUploadProgress(Math.round(totalProgress / validFiles.length));
      };

      const uploadPromises = validFiles.map(async (file, index) => {
        try {
          await uploadFile(file, (progress) => {
            progresses[index] = progress;
            updateOverallProgress();
          });
          uploadedCount++;
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
          errors.push(
            `"${file.name}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      });

      await Promise.all(uploadPromises);

      if (uploadedCount > 0) {
        setHasFetched(false);
      }

      if (errors.length > 0) {
        setError(errors.join('\n'));
      }

      setUploading(false);
      setUploadProgress(0);
    },
    [uploadFile]
  );

  const fetchDocuments = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const result = await db
        .select({
          id: files.id,
          name: files.name,
          size: files.size,
          mimeType: files.mimeType,
          uploadDate: files.uploadDate,
          storagePath: files.storagePath,
          thumbnailPath: files.thumbnailPath,
          deleted: files.deleted
        })
        .from(files)
        .where(
          and(
            or(
              eq(files.mimeType, PDF_MIME_TYPE),
              like(files.mimeType, 'text/%')
            ),
            showDeleted ? undefined : eq(files.deleted, false)
          )
        )
        .orderBy(desc(files.uploadDate));

      const documentList: DocumentInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath,
        thumbnailPath: row.thumbnailPath,
        deleted: row.deleted
      }));

      // Load thumbnails for documents that have them
      const keyManager = getKeyManager();
      const encryptionKey = keyManager.getCurrentKey();
      if (!encryptionKey) throw new Error('Database not unlocked');
      if (!currentInstanceId) throw new Error('No active instance');

      if (!isFileStorageInitialized()) {
        await initializeFileStorage(encryptionKey, currentInstanceId);
      }

      const storage = getFileStorage();
      const documentsWithUrls: DocumentWithUrl[] = await Promise.all(
        documentList.map(async (doc) => {
          let thumbnailUrl: string | null = null;
          if (doc.thumbnailPath) {
            try {
              const data = await storage.retrieve(doc.thumbnailPath);
              const blob = new Blob([data.slice()], { type: 'image/jpeg' });
              thumbnailUrl = URL.createObjectURL(blob);
            } catch (err) {
              console.warn(`Failed to load thumbnail for ${doc.name}:`, err);
            }
          }
          return { ...doc, thumbnailUrl };
        })
      );

      setDocuments(documentsWithUrls);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, currentInstanceId, showDeleted]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: documents and hasFetched intentionally excluded to prevent re-fetch loops
  useEffect(() => {
    // Check if we need to fetch for this instance
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      // If instance changed, cleanup old thumbnail URLs first
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        for (const doc of documents) {
          if (doc.thumbnailUrl) {
            URL.revokeObjectURL(doc.thumbnailUrl);
          }
        }
        setDocuments([]);
        setError(null);
      }

      // Update ref before fetching to prevent re-entry
      fetchedForInstanceRef.current = currentInstanceId;

      // Defer fetch to next tick to ensure database singleton is updated
      const timeoutId = setTimeout(() => {
        fetchDocuments();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [isUnlocked, loading, hasFetched, currentInstanceId, fetchDocuments]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const doc of documents) {
        if (doc.thumbnailUrl) {
          URL.revokeObjectURL(doc.thumbnailUrl);
        }
      }
    };
  }, [documents]);

  useEffect(() => {
    if (refreshToken === undefined || refreshToken === 0) return;
    setHasFetched(false);
  }, [refreshToken]);

  const handleDocumentClick = useCallback(
    (document: DocumentWithUrl) => {
      if (onSelectDocument) {
        onSelectDocument(document.id);
        return;
      }
      navigateWithFrom(`/documents/${document.id}`, {
        fromLabel: 'Back to Documents'
      });
    },
    [navigateWithFrom, onSelectDocument]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, document: DocumentWithUrl) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ document, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleBlankSpaceContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!onUpload) return;
      e.preventDefault();
      setBlankSpaceMenu({ x: e.clientX, y: e.clientY });
    },
    [onUpload]
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      if (onSelectDocument) {
        onSelectDocument(contextMenu.document.id);
      } else {
        navigateWithFrom(`/documents/${contextMenu.document.id}`, {
          fromLabel: 'Back to Documents'
        });
      }
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom, onSelectDocument]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, contextMenu.document.id));

      setHasFetched(false);
    } catch (err) {
      console.error('Failed to delete document:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleRestore = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: false })
        .where(eq(files.id, contextMenu.document.id));

      setHasFetched(false);
    } catch (err) {
      console.error('Failed to restore document:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const openAIChat = useCallback(() => {
    if (onOpenAIChat) {
      onOpenAIChat();
      return;
    }
    navigateWithFrom('/chat', { fromLabel: 'Back to Documents' });
  }, [navigateWithFrom, onOpenAIChat]);

  const handleAddToAIChat = useCallback(async () => {
    if (!contextMenu) return;

    try {
      if (contextMenu.document.thumbnailUrl) {
        const imageDataUrl = await objectUrlToDataUrl(
          contextMenu.document.thumbnailUrl
        );
        setAttachedImage(imageDataUrl);
      }
      openAIChat();
    } catch (err) {
      console.error('Failed to add document to AI chat:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, openAIChat]);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <h1 className="font-bold text-2xl tracking-tight">Documents</h1>
          </div>
          {isUnlocked && (
            <RefreshButton onClick={fetchDocuments} loading={loading} />
          )}
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="documents" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading documents...
          </div>
        ) : uploading ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg border p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium">Uploading...</p>
            </div>
            <UploadProgress progress={uploadProgress} />
          </div>
        ) : documents.length === 0 && hasFetched ? (
          !isTableView && showDropzone ? (
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="application/pdf,text/*"
              multiple={true}
              disabled={uploading}
              label="PDF or text documents"
              source="files"
            />
          ) : (
            // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state
            <div
              className="rounded-lg border p-8 text-center text-muted-foreground"
              onContextMenu={handleBlankSpaceContextMenu}
            >
              No documents yet. Use Upload to add documents.
            </div>
          )
        ) : isTableView ? (
          <DocumentsTableView
            documents={documents}
            canShare={canShare}
            onDocumentClick={handleDocumentClick}
            onContextMenu={handleContextMenu}
            onBlankSpaceContextMenu={handleBlankSpaceContextMenu}
            onDownload={handleDownload}
            onShare={handleShare}
          />
        ) : (
          <DocumentsListView
            documents={documents}
            canShare={canShare}
            showDropzone={showDropzone}
            uploading={uploading}
            onDocumentClick={handleDocumentClick}
            onContextMenu={handleContextMenu}
            onBlankSpaceContextMenu={handleBlankSpaceContextMenu}
            onDownload={handleDownload}
            onShare={handleShare}
            onFilesSelected={handleFilesSelected}
          />
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          {contextMenu.document.deleted ? (
            <ContextMenuItem
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={handleRestore}
            >
              {t('restore')}
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem
                icon={<Info className="h-4 w-4" />}
                onClick={handleGetInfo}
              >
                {t('getInfo')}
              </ContextMenuItem>
              <ContextMenuItem onClick={handleAddToAIChat}>
                Add to AI chat
              </ContextMenuItem>
              <ContextMenuItem
                icon={<Trash2 className="h-4 w-4" />}
                onClick={handleDelete}
              >
                {t('delete')}
              </ContextMenuItem>
            </>
          )}
        </ContextMenu>
      )}

      {blankSpaceMenu && onUpload && (
        <ContextMenu
          x={blankSpaceMenu.x}
          y={blankSpaceMenu.y}
          onClose={() => setBlankSpaceMenu(null)}
        >
          <ContextMenuItem
            icon={<Upload className="h-4 w-4" />}
            onClick={() => {
              onUpload();
              setBlankSpaceMenu(null);
            }}
          >
            Upload
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
