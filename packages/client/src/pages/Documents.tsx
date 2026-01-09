import { useVirtualizer } from '@tanstack/react-virtual';
import { and, desc, eq } from 'drizzle-orm';
import { Download, FileText, Info, Loader2, Share2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { useFileUpload } from '@/hooks/useFileUpload';
import { retrieveFileData } from '@/lib/data-retrieval';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { useNavigateWithFrom } from '@/lib/navigation';
import { formatFileSize } from '@/lib/utils';

const PDF_MIME_TYPE = 'application/pdf';

interface DocumentInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
}

const ROW_HEIGHT_ESTIMATE = 56;

export function Documents() {
  const navigateWithFrom = useNavigateWithFrom();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    document: DocumentInfo;
    x: number;
    y: number;
  } | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { uploadFile } = useFileUpload();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(
    async (document: DocumentInfo, e?: React.MouseEvent) => {
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
    async (document: DocumentInfo, e?: React.MouseEvent) => {
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

      const validFiles = selectedFiles.filter(
        (file) => file.type === PDF_MIME_TYPE
      );
      const invalidFileErrors = selectedFiles
        .filter((file) => file.type !== PDF_MIME_TYPE)
        .map((file) => `"${file.name}" is not a PDF file.`);

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
          storagePath: files.storagePath
        })
        .from(files)
        .where(and(eq(files.mimeType, PDF_MIME_TYPE), eq(files.deleted, false)))
        .orderBy(desc(files.uploadDate));

      const documentList: DocumentInfo[] = result.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath
      }));

      setDocuments(documentList);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && !hasFetched && !loading) {
      fetchDocuments();
    }
  }, [isUnlocked, hasFetched, loading, fetchDocuments]);

  const handleDocumentClick = useCallback(
    (document: DocumentInfo) => {
      navigateWithFrom(`/documents/${document.id}`, {
        fromLabel: 'Back to Documents'
      });
    },
    [navigateWithFrom]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, document: DocumentInfo) => {
      e.preventDefault();
      setContextMenu({ document, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      navigateWithFrom(`/documents/${contextMenu.document.id}`, {
        fromLabel: 'Back to Documents'
      });
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Documents</h1>
        </div>
        {isUnlocked && (
          <RefreshButton onClick={fetchDocuments} loading={loading} />
        )}
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
              <p className="text-muted-foreground text-sm">
                {uploadProgress}% complete
              </p>
            </div>
          </div>
        ) : documents.length === 0 && hasFetched ? (
          <Dropzone
            onFilesSelected={handleFilesSelected}
            accept="application/pdf"
            multiple={true}
            disabled={uploading}
            label="PDF documents"
            source="files"
          />
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col space-y-2"
            data-testid="documents-list"
          >
            <p className="text-muted-foreground text-sm">
              {documents.length} document{documents.length !== 1 && 's'}
            </p>
            <div className="flex-1 rounded-lg border">
              <div ref={parentRef} className="h-full overflow-auto">
                <div
                  className="relative w-full"
                  style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                  {virtualItems.map((virtualItem) => {
                    const document = documents[virtualItem.index];
                    if (!document) return null;

                    return (
                      <div
                        key={document.id}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full px-1 py-0.5"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`
                        }}
                      >
                        <ListRow
                          onContextMenu={(e) => handleContextMenu(e, document)}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                            onClick={() => handleDocumentClick(document)}
                          >
                            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-sm">
                                {document.name}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {formatFileSize(document.size)} ·{' '}
                                {document.uploadDate.toLocaleDateString()}
                              </p>
                            </div>
                          </button>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => handleDownload(document, e)}
                              title="Download"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {canShare && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => handleShare(document, e)}
                                title="Share"
                              >
                                <Share2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </ListRow>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <Dropzone
              onFilesSelected={handleFilesSelected}
              accept="application/pdf"
              multiple={true}
              disabled={uploading}
              label="PDF documents"
              source="files"
              compact
            />
          </div>
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={handleGetInfo}
          >
            Get info
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
