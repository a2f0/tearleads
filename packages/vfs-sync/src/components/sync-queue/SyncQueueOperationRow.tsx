import { cn } from '@tearleads/ui';

interface SyncQueueOperationRowProps {
  kind: string;
  id: string;
  detail?: string | undefined;
  timestamp?: string | undefined;
}

function truncateId(value: string, maxLength = 8): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function SyncQueueOperationRow({
  kind,
  id,
  detail,
  timestamp
}: SyncQueueOperationRowProps) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium font-mono text-[10px] uppercase',
          'bg-muted text-muted-foreground'
        )}
      >
        {kind}
      </span>
      <span className="truncate font-mono text-foreground text-xs" title={id}>
        {truncateId(id)}
      </span>
      {detail ? (
        <span className="truncate text-muted-foreground text-xs">{detail}</span>
      ) : null}
      {timestamp ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          {timestamp}
        </span>
      ) : null}
    </div>
  );
}
