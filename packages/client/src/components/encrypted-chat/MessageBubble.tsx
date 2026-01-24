import { cn } from '@/lib/utils';

export interface MessageBubbleProps {
  children: React.ReactNode;
  isOwn: boolean;
  senderName?: string;
  senderInitial?: string;
  timestamp?: Date;
  className?: string;
}

export function MessageBubble({
  children,
  isOwn,
  senderName,
  senderInitial,
  timestamp,
  className
}: MessageBubbleProps) {
  if (isOwn) {
    return (
      <div className={cn('flex w-full justify-end py-2', className)}>
        <div className="max-w-[80%]">
          <div className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">
            <div className="whitespace-pre-line break-words">{children}</div>
          </div>
          {timestamp && (
            <div className="mt-1 text-right text-xs text-muted-foreground">
              {formatTime(timestamp)}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex w-full py-2', className)}>
      <div className="flex max-w-[80%] gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
          {senderInitial ?? '?'}
        </div>
        <div>
          {senderName && (
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {senderName}
            </div>
          )}
          <div className="rounded-lg bg-muted px-4 py-2">
            <div className="whitespace-pre-line break-words">{children}</div>
          </div>
          {timestamp && (
            <div className="mt-1 text-xs text-muted-foreground">
              {formatTime(timestamp)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
