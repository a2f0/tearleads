import { and, eq, inArray } from 'drizzle-orm';
import { Calendar, FileType, HardDrive, Loader2 } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ActionToolbar, type ActionType } from '@/components/ui/action-toolbar';
import { BackLink } from '@/components/ui/back-link';
import { EditableTitle } from '@/components/ui/editable-title';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { files } from '@/db/schema';
import { retrieveFileData } from '@/lib/data-retrieval';
import { canShareFiles, downloadFile, shareFile } from '@/lib/file-utils';
import { formatDate, formatFileSize } from '@/lib/utils';

const PdfViewer = lazy(() =>
  import('@/components/pdf').then((m) => ({ default: m.PdfViewer }))
);

const PDF_MIME_TYPE = 'application/pdf';
const TEXT_MIME_TYPE = 'text/plain';
const DOCUMENT_MIME_TYPES = [PDF_MIME_TYPE, TEXT_MIME_TYPE];

interface DocumentInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadDate: Date;
  storagePath: string;
}

export function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [document, setDocument] = useState<DocumentInfo | null>(null);
  const [documentData, setDocumentData] = useState<Uint8Array | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [actionLoading, setActionLoading] = useState<ActionType | null>(null);
  // Track loaded storage path to prevent duplicate loads during rapid state changes
  const loadedStoragePathRef = useRef<string | null>(null);

  useEffect(() => {
    setCanShare(canShareFiles());
  }, []);

  const handleDownload = useCallback(async () => {
    if (!document) return;

    setActionLoading('download');
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
    } finally {
      setActionLoading(null);
    }
  }, [document, currentInstanceId]);

  const handleShare = useCallback(async () => {
    if (!document) return;

    setActionLoading('share');
    try {
      if (!currentInstanceId) throw new Error('No active instance');
      const data = await retrieveFileData(
        document.storagePath,
        currentInstanceId
      );
      const shared = await shareFile(data, document.name, document.mimeType);
      if (!shared) {
        setError('Sharing is not supported on this device');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to share document:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [document, currentInstanceId]);

  const handleDelete = useCallback(async () => {
    if (!document) return;

    setActionLoading('delete');
    try {
      const db = getDatabase();
      await db
        .update(files)
        .set({ deleted: true })
        .where(eq(files.id, document.id));

      navigate('/documents');
    } catch (err) {
      console.error('Failed to delete document:', err);
      setError(err instanceof Error ? err.message : String(err));
      setActionLoading(null);
    }
  }, [document, navigate]);

  const handleUpdateName = useCallback(
    async (newName: string) => {
      if (!id) return;

      const db = getDatabase();
      await db.update(files).set({ name: newName }).where(eq(files.id, id));

      setDocument((prev) => (prev ? { ...prev, name: newName } : prev));
    },
    [id]
  );

  const fetchDocument = useCallback(async () => {
    if (!isUnlocked || !id) return;

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
        .where(
          and(
            eq(files.id, id),
            inArray(files.mimeType, DOCUMENT_MIME_TYPES),
            eq(files.deleted, false)
          )
        )
        .limit(1);

      const row = result[0];
      if (!row) {
        setError('Document not found');
        return;
      }

      const documentInfo: DocumentInfo = {
        id: row.id,
        name: row.name,
        size: row.size,
        mimeType: row.mimeType,
        uploadDate: row.uploadDate,
        storagePath: row.storagePath
      };
      setDocument(documentInfo);
    } catch (err) {
      console.error('Failed to fetch document:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked, id]);

  useEffect(() => {
    if (isUnlocked && id) {
      fetchDocument();
    }
  }, [isUnlocked, id, fetchDocument]);

  useEffect(() => {
    if (!document || !currentInstanceId) return;
    // Skip if we already loaded this document to avoid race conditions
    // when dependencies change rapidly during unlock flow
    if (loadedStoragePathRef.current === document.storagePath) return;

    let cancelled = false;

    const loadDocumentData = async () => {
      setContentLoading(true);
      try {
        const data = await retrieveFileData(
          document.storagePath,
          currentInstanceId
        );
        if (!cancelled) {
          loadedStoragePathRef.current = document.storagePath;
          if (document.mimeType === TEXT_MIME_TYPE) {
            const decoder = new TextDecoder('utf-8');
            setTextContent(decoder.decode(data));
          } else {
            setDocumentData(data);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load document data:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setContentLoading(false);
        }
      }
    };

    loadDocumentData();

    return () => {
      cancelled = true;
    };
  }, [document, currentInstanceId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <BackLink defaultTo="/documents" defaultLabel="Back to Documents" />
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description="this document" />
      )}

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
          {error}
        </div>
      )}

      {isUnlocked && loading && (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading document...
        </div>
      )}

      {isUnlocked && !loading && !error && document && (
        <div className="space-y-6">
          <EditableTitle
            value={document.name}
            onSave={handleUpdateName}
            data-testid="document-title"
          />

          {contentLoading && (
            <div
              className="flex items-center justify-center gap-2 rounded-lg border bg-muted p-12 text-muted-foreground"
              data-testid="content-loading"
            >
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading document...
            </div>
          )}

          {!contentLoading &&
            documentData &&
            document.mimeType === PDF_MIME_TYPE && (
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted p-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading viewer...
                  </div>
                }
              >
                <PdfViewer data={documentData} />
              </Suspense>
            )}

          {!contentLoading &&
            textContent !== null &&
            document.mimeType === TEXT_MIME_TYPE && (
              <div
                className="overflow-auto rounded-lg border bg-muted p-4"
                data-testid="text-viewer"
              >
                <pre className="whitespace-pre-wrap break-words font-mono text-sm">
                  {textContent}
                </pre>
              </div>
            )}

          <ActionToolbar
            onDownload={handleDownload}
            onShare={handleShare}
            onDelete={handleDelete}
            loadingAction={actionLoading}
            canShare={canShare}
          />

          <div className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Document Details</h2>
            </div>
            <div className="divide-y">
              <div className="flex items-center gap-3 px-4 py-3">
                <FileType className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Type</span>
                <span className="ml-auto font-mono text-sm">
                  {document.mimeType}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Size</span>
                <span className="ml-auto font-mono text-sm">
                  {formatFileSize(document.size)}
                </span>
              </div>
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground text-sm">Uploaded</span>
                <span className="ml-auto text-sm">
                  {formatDate(document.uploadDate)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
