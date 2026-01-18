import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';

interface OpfsWindowMenuBarProps {
  onRefresh: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onClose: () => void;
}

export function OpfsWindowMenuBar({
  onRefresh,
  onExpandAll,
  onCollapseAll,
  onClose
}: OpfsWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onRefresh}>Refresh</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem onClick={onExpandAll}>Expand All</DropdownMenuItem>
        <DropdownMenuItem onClick={onCollapseAll}>Collapse All</DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
