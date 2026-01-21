import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { ModelSelector } from '@/components/ModelSelector';
import { PreserveWindowStateMenuItem } from '@/components/window-menu/PreserveWindowStateMenuItem';

interface ChatWindowMenuBarProps {
  onNewChat: () => void;
  onClose: () => void;
  modelDisplayName: string | undefined;
}

export function ChatWindowMenuBar({
  onNewChat,
  onClose,
  modelDisplayName
}: ChatWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-1">
      <div className="flex items-center">
        <DropdownMenu trigger="File">
          <DropdownMenuItem onClick={onNewChat}>New Chat</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
        </DropdownMenu>
        <DropdownMenu trigger="View">
          <PreserveWindowStateMenuItem />
        </DropdownMenu>
      </div>
      <div className="pr-1">
        <ModelSelector modelDisplayName={modelDisplayName} variant="compact" />
      </div>
    </div>
  );
}
