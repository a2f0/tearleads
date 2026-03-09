import { File, X } from 'lucide-react';
import { useCallback } from 'react';
import type { Attachment } from '../../types';
import { formatFileSize } from '../../types';

interface AttachmentListProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export function AttachmentList({
  attachments,
  onRemove,
  disabled = false
}: AttachmentListProps) {
  const handleRemove = useCallback(
    (id: string) => {
      if (!disabled) {
        onRemove(id);
      }
    },
    [onRemove, disabled]
  );

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="attachment-list">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1"
          data-testid={`attachment-item-${attachment.id}`}
        >
          <File className="h-4 w-4 text-muted-foreground" />
          <span className="max-w-[150px] truncate text-sm">
            {attachment.fileName}
          </span>
          <span className="text-muted-foreground text-xs">
            ({formatFileSize(attachment.size)})
          </span>
          <button
            type="button"
            onClick={() => handleRemove(attachment.id)}
            disabled={disabled}
            className="ml-1 rounded p-0.5 hover:bg-destructive/20 disabled:opacity-50"
            aria-label={`Remove ${attachment.fileName}`}
            data-testid={`remove-attachment-${attachment.id}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
