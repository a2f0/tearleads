import type { SSEConnectionState } from '@rapid/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SSEConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionState: SSEConnectionState;
}

const stateLabels: Record<SSEConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  disconnected: 'Disconnected'
};

const stateColors: Record<SSEConnectionState, string> = {
  connected: 'text-green-500',
  connecting: 'text-yellow-500',
  disconnected: 'text-red-500'
};

export function SSEConnectionDialog({
  isOpen,
  onClose,
  connectionState
}: SSEConnectionDialogProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
        data-testid="sse-dialog-backdrop"
      />
      <div
        className="fixed top-1/2 left-1/2 z-50 w-80 max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="SSE Connection Details"
        data-testid="sse-dialog"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-lg">Connection Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Status</dt>
            <dd className={cn('font-medium', stateColors[connectionState])}>
              {stateLabels[connectionState]}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Server</dt>
            <dd className="truncate font-mono text-xs">
              {API_BASE_URL || 'Not configured'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Endpoint</dt>
            <dd className="font-mono text-xs">/sse</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
