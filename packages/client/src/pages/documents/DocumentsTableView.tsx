import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { Download, FileText, Share2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/lib/utils';
import type {
  DocumentWithUrl,
  SortColumn,
  SortDirection
} from './documentTypes';
import { getDocumentTypeLabel } from './documentTypes';
import { SortHeader } from './SortHeader';

interface DocumentsTableViewProps {
  documents: DocumentWithUrl[];
  canShare: boolean;
  onDocumentClick: (document: DocumentWithUrl) => void;
  onContextMenu: (e: React.MouseEvent, document: DocumentWithUrl) => void;
  onBlankSpaceContextMenu: (e: React.MouseEvent) => void;
  onDownload: (document: DocumentWithUrl, e?: React.MouseEvent) => void;
  onShare: (document: DocumentWithUrl, e?: React.MouseEvent) => void;
}

export function DocumentsTableView({
  documents,
  canShare,
  onDocumentClick,
  onContextMenu,
  onBlankSpaceContextMenu,
  onDownload,
  onShare
}: DocumentsTableViewProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSortChange = useCallback(
    (column: SortColumn) => {
      if (column === sortColumn) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        return;
      }
      setSortColumn(column);
      setSortDirection('asc');
    },
    [sortColumn]
  );

  const sortedDocuments = useMemo(() => {
    const sorted = [...documents].sort((a, b) => {
      switch (sortColumn) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return a.size - b.size;
        case 'mimeType':
          return a.mimeType.localeCompare(b.mimeType);
        case 'uploadDate':
          return a.uploadDate.getTime() - b.uploadDate.getTime();
        default:
          return 0;
      }
    });

    return sortDirection === 'asc' ? sorted : sorted.reverse();
  }, [documents, sortColumn, sortDirection]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu on empty space */}
      <div
        className="flex-1 overflow-auto rounded-lg border"
        onContextMenu={onBlankSpaceContextMenu}
      >
        <table
          className={WINDOW_TABLE_TYPOGRAPHY.table}
          data-testid="documents-table"
        >
          <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
            <tr>
              <th scope="col" className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <SortHeader
                  column="name"
                  label="Name"
                  currentColumn={sortColumn}
                  direction={sortDirection}
                  onClick={handleSortChange}
                />
              </th>
              <th scope="col" className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <SortHeader
                  column="size"
                  label="Size"
                  currentColumn={sortColumn}
                  direction={sortDirection}
                  onClick={handleSortChange}
                />
              </th>
              <th scope="col" className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <SortHeader
                  column="mimeType"
                  label="Type"
                  currentColumn={sortColumn}
                  direction={sortDirection}
                  onClick={handleSortChange}
                />
              </th>
              <th scope="col" className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                <SortHeader
                  column="uploadDate"
                  label="Date"
                  currentColumn={sortColumn}
                  direction={sortDirection}
                  onClick={handleSortChange}
                />
              </th>
              <th
                scope="col"
                className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedDocuments.map((document) => (
              <WindowTableRow
                key={document.id}
                onClick={() => onDocumentClick(document)}
                onContextMenu={(event) => onContextMenu(event, document)}
              >
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  <div className="flex min-w-0 items-center gap-2">
                    {document.thumbnailUrl ? (
                      <img
                        src={document.thumbnailUrl}
                        alt={`Thumbnail for ${document.name}`}
                        className="h-7 w-7 shrink-0 rounded border object-cover"
                      />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{document.name}</span>
                  </div>
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                  {formatFileSize(document.size)}
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                  {getDocumentTypeLabel(document.mimeType)}
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.mutedCell}>
                  {document.uploadDate.toLocaleDateString()}
                </td>
                <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                  <div className="flex justify-end gap-1">
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
                </td>
              </WindowTableRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
