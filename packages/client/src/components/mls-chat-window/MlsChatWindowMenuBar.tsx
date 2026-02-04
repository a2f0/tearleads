import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

interface MlsChatWindowMenuBarProps {
  onClose: () => void;
}

export function MlsChatWindowMenuBar({
  onClose
}: MlsChatWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <AboutMenuItem appName="MLS Chat" closeLabel="Close" />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
