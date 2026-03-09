import { WindowContextMenu } from '@tearleads/window-manager';
import { CornerUpLeft, Forward, ReplyAll } from 'lucide-react';
import type { ComposeMode } from '../lib/quoteText.js';

interface EmailListContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onComposeForMode: (mode: ComposeMode) => void;
}

export function EmailListContextMenu({
  x,
  y,
  onClose,
  onComposeForMode
}: EmailListContextMenuProps) {
  return (
    <WindowContextMenu
      x={x}
      y={y}
      onClose={onClose}
      backdropTestId="email-list-context-menu-backdrop"
      menuTestId="email-list-context-menu"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onComposeForMode('reply');
          onClose();
        }}
      >
        <CornerUpLeft className="h-4 w-4" />
        Reply
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onComposeForMode('replyAll');
          onClose();
        }}
      >
        <ReplyAll className="h-4 w-4" />
        Reply All
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        onClick={() => {
          onComposeForMode('forward');
          onClose();
        }}
      >
        <Forward className="h-4 w-4" />
        Forward
      </button>
    </WindowContextMenu>
  );
}
