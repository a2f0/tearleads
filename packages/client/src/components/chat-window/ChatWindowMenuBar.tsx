import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';

interface ChatWindowMenuBarProps {
  onNewChat: () => void;
  onClose: () => void;
}

export function ChatWindowMenuBar({
  onNewChat,
  onClose
}: ChatWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onNewChat}>New Chat</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
