import type { VirtualItem } from '@tanstack/react-virtual';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject
} from 'react';
import type { ColumnInfo } from './exportTableCsv';

type SortDirection = 'asc' | 'desc' | null;

export interface SortState {
  column: string | null;
  direction: SortDirection;
}

export interface UseTableRowsControllerArgs {
  tableName: string | null;
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
  onStatusTextChange?: (text: string) => void;
  onExportCsvChange?: (
    handler: (() => Promise<void>) | null,
    exporting: boolean
  ) => void;
}

export interface UseTableRowsControllerResult {
  parentRef: RefObject<HTMLDivElement | null>;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  totalCount: number | null;
  documentView: boolean;
  sort: SortState;
  hiddenColumns: Set<string>;
  visibleColumns: ColumnInfo[];
  columnWidths: Record<string, number>;
  resizingColumn: string | null;
  confirmTruncate: boolean;
  truncating: boolean;
  firstVisible: number | null;
  lastVisible: number | null;
  virtualItems: VirtualItem[];
  totalSize: number;
  measureElement: (element: HTMLDivElement | null) => void;
  onSort: (columnName: string) => void;
  onToggleColumn: (columnName: string) => void;
  onToggleDocumentView: () => void;
  onTruncateClick: () => Promise<void>;
  onResizeStart: (
    column: string,
    event: ReactMouseEvent<HTMLDivElement>
  ) => void;
  onKeyboardResize: (column: string, event: ReactKeyboardEvent) => void;
  onRefresh: () => Promise<void>;
}
