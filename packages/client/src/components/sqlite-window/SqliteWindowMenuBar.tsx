import { WindowMenuBar } from '@tearleads/window-manager';
import { Download, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface SqliteWindowMenuBarProps {
  onClose: () => void;
  onRefresh: () => void;
  onExportCsv?: () => void;
  exportCsvDisabled?: boolean;
  showExportCsv?: boolean;
}

export function SqliteWindowMenuBar({
  onClose,
  onRefresh,
  onExportCsv,
  exportCsvDisabled = false,
  showExportCsv = true
}: SqliteWindowMenuBarProps) {
  const handleExportCsv = () => {
    onExportCsv?.();
  };

  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        {showExportCsv && (
          <>
            <DropdownMenuItem
              onClick={handleExportCsv}
              icon={<Download className="h-3 w-3" />}
              disabled={!onExportCsv || exportCsvDisabled}
            >
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={onRefresh}
          icon={<RefreshCw className="h-3 w-3" />}
        >
          Refresh
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
