import { useState } from 'react';
import { formatFileSize } from '@/lib/utils';
import { StorageDeleteButton } from './StorageDeleteButton';

export interface StorageEntry {
  key: string;
  value: string;
  size: number;
}

interface StorageRowProps {
  entry: StorageEntry;
  onDelete: (key: string) => void;
}

export function StorageRow({ entry, onDelete }: StorageRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isLongValue = entry.value.length > 100;
  const displayValue = expanded ? entry.value : entry.value.slice(0, 100);

  return (
    <div className="group border-b last:border-b-0">
      <div className="flex items-start gap-4 px-4 py-3 hover:bg-accent">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono text-sm">{entry.key}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {formatFileSize(entry.size)}
            </span>
          </div>
          <div className="mt-1">
            <pre className="whitespace-pre-wrap break-all font-mono text-muted-foreground text-xs">
              {displayValue}
              {isLongValue && !expanded && '...'}
            </pre>
            {isLongValue && (
              <button
                type="button"
                className="mt-1 text-primary text-xs hover:underline"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>
        <StorageDeleteButton onClick={() => onDelete(entry.key)} />
      </div>
    </div>
  );
}
