import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';

interface DebugWindowMenuBarProps {
  onClose: () => void;
}

export function DebugWindowMenuBar({ onClose }: DebugWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
