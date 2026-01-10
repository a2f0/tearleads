import type { RedisKeyInfo, RedisKeyValueResponse } from '@rapid/shared';
import { ChevronDown, ChevronRight, Database, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RedisKeyRowProps {
  keyInfo: RedisKeyInfo;
  isExpanded: boolean;
  onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
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

function renderStringValue(value: string) {
  return (
    <div className="mt-2">
      <p className="mb-1 font-medium text-muted-foreground text-xs">Value:</p>
      <pre className="overflow-auto rounded bg-muted p-2 font-mono text-xs">
        {value}
      </pre>
    </div>
  );
}

function renderSetValue(value: string[]) {
  return (
    <div className="mt-2">
      <p className="mb-1 font-medium text-muted-foreground text-xs">
        Members ({value.length}):
      </p>
      <ul className="space-y-1">
        {value.map((member) => (
          <li
            key={member}
            className="rounded bg-muted px-2 py-1 font-mono text-xs"
          >
            {member}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderHashValue(value: Record<string, string>) {
  const entries = Object.entries(value);
  return (
    <div className="mt-2">
      <p className="mb-1 font-medium text-muted-foreground text-xs">
        Fields ({entries.length}):
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="px-2 py-1 text-left font-medium text-muted-foreground">
              Field
            </th>
            <th className="px-2 py-1 text-left font-medium text-muted-foreground">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([field, fieldValue]) => (
            <tr key={field} className="border-b last:border-b-0">
              <td className="px-2 py-1 font-mono">{field}</td>
              <td className="px-2 py-1 font-mono">{fieldValue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderValue(data: RedisKeyValueResponse) {
  const { type, value } = data;

  if (value === null) {
    return (
      <p className="mt-2 text-muted-foreground text-xs italic">
        Value display not supported for this type
      </p>
    );
  }

  switch (type) {
    case 'string':
      if (typeof value === 'string') {
        return renderStringValue(value);
      }
      break;
    case 'set':
      if (Array.isArray(value)) {
        return renderSetValue(value);
      }
      break;
    case 'hash':
      if (typeof value === 'object' && !Array.isArray(value)) {
        return renderHashValue(value);
      }
      break;
  }

  return null;
}

export function RedisKeyRow({
  keyInfo,
  isExpanded,
  onToggle,
  onContextMenu
}: RedisKeyRowProps) {
  const [valueData, setValueData] = useState<RedisKeyValueResponse | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded || valueData) {
      return;
    }

    let isCancelled = false;

    const fetchValue = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.admin.redis.getValue(keyInfo.key);
        if (!isCancelled) {
          setValueData(data);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to fetch value'
          );
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    fetchValue();

    return () => {
      isCancelled = true;
    };
  }, [isExpanded, keyInfo.key, valueData]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Context menu on div is intentional
    <div className="border-b last:border-b-0" onContextMenu={onContextMenu}>
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

          {loading && (
            <div className="flex items-center text-muted-foreground text-xs">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Loading value...
            </div>
          )}

          {error && (
            <div className="text-destructive text-xs">Error: {error}</div>
          )}

          {valueData && renderValue(valueData)}
        </div>
      )}
    </div>
  );
}
