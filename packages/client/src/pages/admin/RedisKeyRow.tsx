import type { RedisKeyInfo } from '@rapid/shared';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RedisKeyRowProps {
  keyInfo: RedisKeyInfo;
  isExpanded: boolean;
  onToggle: () => void;
}

function getTypeBadgeColor(type: string): string {
  switch (type) {
    case 'string':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    case 'list':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'set':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
    case 'hash':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    case 'zset':
      return 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200';
    case 'stream':
      return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
  }
}

function formatTtl(ttl: number): string {
  if (ttl === -1) return 'No expiry';
  if (ttl === -2) return 'Key not found';
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
  return `${Math.floor(ttl / 86400)}d`;
}

export function RedisKeyRow({
  keyInfo,
  isExpanded,
  onToggle
}: RedisKeyRowProps) {
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-center gap-2 p-3 text-left hover:bg-accent"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Database className="h-4 w-4 text-red-500" />
        <span className="flex-1 truncate font-mono text-sm">{keyInfo.key}</span>
        <span
          className={cn(
            'rounded px-2 py-0.5 font-mono text-xs',
            getTypeBadgeColor(keyInfo.type)
          )}
        >
          {keyInfo.type}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatTtl(keyInfo.ttl)}
        </span>
      </button>
      {isExpanded && (
        <div className="space-y-2 bg-muted/30 px-9 py-3">
          <div className="text-muted-foreground text-xs">
            <p>
              <span className="font-medium">Key:</span> {keyInfo.key}
            </p>
            <p>
              <span className="font-medium">Type:</span> {keyInfo.type}
            </p>
            <p>
              <span className="font-medium">TTL:</span>{' '}
              {keyInfo.ttl === -1
                ? 'No expiry'
                : keyInfo.ttl === -2
                  ? 'Key not found'
                  : `${keyInfo.ttl} seconds`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
