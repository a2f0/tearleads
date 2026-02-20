import { useVirtualizer } from '@tanstack/react-virtual';
import { Download, FileText, Share2 } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { ListRow } from '@/components/ui/ListRow';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { useVirtualVisibleRange } from '@/hooks/device';
import { formatFileSize } from '@/lib/utils';
import type { DocumentWithUrl } from './documentTypes';

const ROW_HEIGHT_ESTIMATE = 56;

interface DocumentsListViewProps {
  documents: DocumentWithUrl[];
  canShare: boolean;
  showDropzone: boolean;
  uploading: boolean;
  onDocumentClick: (document: DocumentWithUrl) => void;
  onContextMenu: (e: React.MouseEvent, document: DocumentWithUrl) => void;
  onBlankSpaceContextMenu: (e: React.MouseEvent) => void;
  onDownload: (document: DocumentWithUrl, e?: React.MouseEvent) => void;
  onShare: (document: DocumentWithUrl, e?: React.MouseEvent) => void;
  onFilesSelected: (files: File[]) => void;
}

export function DocumentsListView({
  documents,
  canShare,
  showDropzone,
  uploading,
  onDocumentClick,
  onContextMenu,
  onBlankSpaceContextMenu,
  onDownload,
  onShare,
  onFilesSelected
}: DocumentsListViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const { firstVisible, lastVisible } = useVirtualVisibleRange(virtualItems);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col space-y-2"
      data-testid="documents-list"
    >
      <VirtualListStatus
        firstVisible={firstVisible}
        lastVisible={lastVisible}
        loadedCount={documents.length}
        itemLabel="document"
      />
      <div className="flex-1 rounded-lg border">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space */}
        <div
          ref={parentRef}
          className="h-full overflow-auto"
          onContextMenu={onBlankSpaceContextMenu}
        >
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
                  <ListRow onContextMenu={(e) => onContextMenu(e, document)}>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 overflow-hidden text-left"
                      onClick={() => onDocumentClick(document)}
                    >
                      {document.thumbnailUrl ? (
                        <img
                          src={document.thumbnailUrl}
                          alt={`Thumbnail for ${document.name}`}
                          className="h-10 w-10 shrink-0 rounded border object-cover"
                        />
                      ) : (
                        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                      )}
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
                        onClick={(e) => onDownload(document, e)}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {canShare && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => onShare(document, e)}
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
      {showDropzone && (
        <Dropzone
          onFilesSelected={onFilesSelected}
          accept="application/pdf,text/*"
          multiple={true}
          disabled={uploading}
          label="PDF or text documents"
          source="files"
          compact
          variant="row"
        />
      )}
    </div>
  );
}
