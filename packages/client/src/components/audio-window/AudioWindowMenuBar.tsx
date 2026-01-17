import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';

interface AudioWindowMenuBarProps {
  onClose: () => void;
}

export function AudioWindowMenuBar({ onClose }: AudioWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
