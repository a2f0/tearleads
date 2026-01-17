import { Minimize2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';

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
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={() => onCompactChange(!compact)}
          checked={compact}
          icon={<Minimize2 className="h-3 w-3" />}
        >
          Compact
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
