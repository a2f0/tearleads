import { WindowStatusBar } from '@rapid/window-manager';

interface VfsStatusBarProps {
  itemCount: number;
  selectedItemName?: string | null;
  /** Transient message to display (e.g., paste error) */
  message?: { text: string; type: 'error' | 'info' } | null;
}

export function VfsStatusBar({
  itemCount,
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
      ) : (
        <span>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
        </span>
      )}
    </WindowStatusBar>
  );
}
