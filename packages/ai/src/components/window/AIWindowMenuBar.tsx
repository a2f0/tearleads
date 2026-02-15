import { useAIUI } from '../../context';

interface AIWindowMenuBarProps {
  onNewChat: () => void | Promise<void>;
  onClose: () => void;
  modelDisplayName: string | undefined;
}

export function AIWindowMenuBar({
  onNewChat,
  onClose,
  modelDisplayName
}: AIWindowMenuBarProps) {
  const {
    DropdownMenu,
    DropdownMenuItem,
    DropdownMenuSeparator,
    WindowOptionsMenuItem,
    ModelSelector
  } = useAIUI();

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-1">
      <div className="flex items-center">
        <DropdownMenu trigger="File">
          <DropdownMenuItem onClick={onNewChat}>New Chat</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
        </DropdownMenu>
        <DropdownMenu trigger="View">
          <WindowOptionsMenuItem />
        </DropdownMenu>
      </div>
      <div className="pr-1">
        <ModelSelector modelDisplayName={modelDisplayName} variant="compact" />
      </div>
    </div>
  );
}
