import { WindowStatusBar } from '@rapid/window-manager';

interface VfsStatusBarProps {
  itemCount: number;
  selectedItemCount?: number;
  selectedItemName?: string | null;
  /** Transient message to display (e.g., paste error) */
  message?: { text: string; type: 'error' | 'info' } | null;
}

export function VfsStatusBar({
  itemCount,
  selectedItemCount = 0,
  selectedItemName,
  message
}: VfsStatusBarProps) {
  if (message) {
    return (
      <WindowStatusBar tone={message.type}>
        <span className="truncate">{message.text}</span>
      </WindowStatusBar>
    );
  }

  return (
    <WindowStatusBar>
      {selectedItemName ? (
        <span className="truncate">{selectedItemName}</span>
      ) : selectedItemCount > 1 ? (
        <span>{selectedItemCount} items selected</span>
      ) : (
        <span>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
        </span>
      )}
    </WindowStatusBar>
  );
}
