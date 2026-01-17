import { Minimize2 } from 'lucide-react';
import { useCallback } from 'react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';

interface AdminWindowMenuBarProps {
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  onClose: () => void;
}

export function AdminWindowMenuBar({
  compact,
  onCompactChange,
  onClose
}: AdminWindowMenuBarProps) {
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
      </DropdownMenu>
    </div>
  );
}
