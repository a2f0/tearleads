import { Minimize2 } from 'lucide-react';
import { useCallback } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

interface SettingsWindowMenuBarProps {
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  onClose: () => void;
}

export function SettingsWindowMenuBar({
  compact,
  onCompactChange,
  onClose
}: SettingsWindowMenuBarProps) {
  const handleCompactChange = useCallback(() => {
    onCompactChange(!compact);
  }, [compact, onCompactChange]);

  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={handleCompactChange}
          checked={compact}
          icon={<Minimize2 className="h-3 w-3" />}
        >
          Compact
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <PreserveWindowStateMenuItem />
      </DropdownMenu>
    </div>
  );
}
