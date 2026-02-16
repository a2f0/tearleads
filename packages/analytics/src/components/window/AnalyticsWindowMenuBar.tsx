import { Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { WindowMenuBar } from '@tearleads/window-manager';

interface AnalyticsWindowMenuBarProps {
  onClose: () => void;
  onExportCsv?: () => void;
  exportCsvDisabled?: boolean;
}

export function AnalyticsWindowMenuBar({
  onClose,
  onExportCsv,
  exportCsvDisabled = false
}: AnalyticsWindowMenuBarProps) {
  const handleExportCsv = () => {
    onExportCsv?.();
  };

  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          onClick={handleExportCsv}
          icon={<Download className="h-3 w-3" />}
          disabled={!onExportCsv || exportCsvDisabled}
        >
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
    </div>
  );
}
