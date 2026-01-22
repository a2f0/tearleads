import { Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';

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
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
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
    </div>
  );
}
