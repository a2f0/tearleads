import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import {
  FileText,
  Info,
  Loader2,
  RotateCcw,
  Trash2,
  Upload
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { BackLink } from '@/components/ui/back-link';
import { Dropzone } from '@/components/ui/dropzone';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { UploadProgress } from '@/components/ui/UploadProgress';
import { useDatabaseContext } from '@/db/hooks';
import { useTypedTranslation } from '@/i18n';
import { DocumentsListView } from './documents/DocumentsListView';
import { DocumentsTableView } from './documents/DocumentsTableView';
import type { DocumentWithUrl } from './documents/documentTypes';
import { useDocumentsActions } from './documents/useDocumentsActions';
import { useDocumentsData } from './documents/useDocumentsData';
import { useDocumentsUpload } from './documents/useDocumentsUpload';

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

type DocumentsContentState = {
  isUnlocked: boolean;
  error: string | null;
  loading: boolean;
  hasFetched: boolean;
  uploading: boolean;
  uploadProgress: number;
  documents: DocumentWithUrl[];
  isTableView: boolean;
  showDropzone: boolean;
};

type DocumentsContentHandlers = {
  handleFilesSelected: (files: File[]) => void;
  handleBlankSpaceContextMenu: (event: MouseEvent) => void;
  handleDocumentClick: (document: DocumentWithUrl) => void;
  handleContextMenu: (event: MouseEvent, document: DocumentWithUrl) => void;
  handleDownload: (document: DocumentWithUrl, event?: MouseEvent) => void;
  handleShare: (document: DocumentWithUrl, event?: MouseEvent) => void;
};

function renderDocumentsContent(
  state: DocumentsContentState,
  handlers: DocumentsContentHandlers,
  canShare: boolean
) {
  if (!state.isUnlocked || state.error) {
    return null;
  }

  if (state.loading && !state.hasFetched) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading documents...
      </div>
    );
  }

  if (state.uploading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="text-center">
          <p className="font-medium">Uploading...</p>
        </div>
        <UploadProgress progress={state.uploadProgress} />
      </div>
    );
  }

  if (state.documents.length === 0 && state.hasFetched) {
    if (!state.isTableView && state.showDropzone) {
      return (
        <Dropzone
          onFilesSelected={handlers.handleFilesSelected}
          accept="application/pdf,text/*"
          multiple={true}
          disabled={state.uploading}
          label="PDF or text documents"
          source="files"
        />
      );
    }

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty state
      <div
        className="rounded-lg border p-8 text-center text-muted-foreground"
        onContextMenu={handlers.handleBlankSpaceContextMenu}
      >
        No documents yet. Use Upload to add documents.
      </div>
    );
  }

  if (state.isTableView) {
    return (
      <DocumentsTableView
        documents={state.documents}
        canShare={canShare}
        onDocumentClick={handlers.handleDocumentClick}
        onContextMenu={handlers.handleContextMenu}
        onBlankSpaceContextMenu={handlers.handleBlankSpaceContextMenu}
        onDownload={handlers.handleDownload}
        onShare={handlers.handleShare}
      />
    );
  }

  return (
    <DocumentsListView
      documents={state.documents}
      canShare={canShare}
      showDropzone={state.showDropzone}
      uploading={state.uploading}
      onDocumentClick={handlers.handleDocumentClick}
      onContextMenu={handlers.handleContextMenu}
      onBlankSpaceContextMenu={handlers.handleBlankSpaceContextMenu}
      onDownload={handlers.handleDownload}
      onShare={handlers.handleShare}
      onFilesSelected={handlers.handleFilesSelected}
    />
  );
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
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');

  const isTableView = viewMode === 'table';

  const {
    documents,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    fetchDocuments
  } = useDocumentsData(showDeleted, refreshToken);

  const { uploading, uploadProgress, handleFilesSelected } = useDocumentsUpload(
    setError,
    setHasFetched
  );

  const {
    contextMenu,
    blankSpaceMenu,
    canShare,
    handleDownload,
    handleShare,
    handleDocumentClick,
    handleContextMenu,
    handleBlankSpaceContextMenu,
    handleGetInfo,
    handleDelete,
    handleRestore,
    handleCloseContextMenu,
    handleAddToAIChat,
    setBlankSpaceMenu
  } = useDocumentsActions(
    setError,
    setHasFetched,
    onSelectDocument,
    onUpload,
    onOpenAIChat
  );

  const contentState: DocumentsContentState = {
    isUnlocked,
    error,
    loading,
    hasFetched,
    uploading,
    uploadProgress,
    documents,
    isTableView,
    showDropzone
  };

  const contentHandlers: DocumentsContentHandlers = {
    handleFilesSelected,
    handleBlankSpaceContextMenu,
    handleDocumentClick,
    handleContextMenu,
    handleDownload,
    handleShare
  };

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

      {renderDocumentsContent(contentState, contentHandlers, canShare)}

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
