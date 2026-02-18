import { api } from '@tearleads/api-client';
import type { RedisKeyInfo, RedisKeyValueResponse } from '@tearleads/shared';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { ChevronDown, ChevronRight, Database, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTypedTranslation } from '@/i18n';
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
      return 'bg-chart-1/20 text-chart-1';
    case 'list':
      return 'bg-chart-2/20 text-chart-2';
    case 'set':
      return 'bg-chart-4/20 text-chart-4';
    case 'hash':
      return 'bg-chart-5/20 text-chart-5';
    case 'zset':
      return 'bg-chart-7/20 text-chart-7';
    case 'stream':
      return 'bg-chart-6/20 text-chart-6';
    default:
      return 'bg-muted text-muted-foreground';
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

function renderStringValue(value: string, t: (key: string) => string) {
  return (
    <div className="mt-2">
      <p className="mb-1 font-medium text-muted-foreground text-xs">
        {t('value')}:
      </p>
      <pre className="overflow-auto rounded bg-muted p-2 font-mono text-xs">
        {value}
      </pre>
    </div>
  );
}

function renderSetValue(value: string[], t: (key: string) => string) {
  return (
    <div className="mt-2">
      <p className="mb-1 font-medium text-muted-foreground text-xs">
        {t('members')} ({value.length}):
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

function renderHashValue(
  value: Record<string, string>,
  t: (key: string) => string
) {
  const entries = Object.entries(value);
  return (
    <div className="mt-2">
      <p className="mb-1 font-medium text-muted-foreground text-xs">
        {t('field')}s ({entries.length}):
      </p>
      <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
        <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
          <tr className="border-b">
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>{t('field')}</th>
            <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>{t('value')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([field, fieldValue]) => (
            <WindowTableRow
              key={field}
              className="cursor-default last:border-b-0 hover:bg-transparent"
            >
              <td className={`${WINDOW_TABLE_TYPOGRAPHY.cell} font-mono`}>
                {field}
              </td>
              <td className={`${WINDOW_TABLE_TYPOGRAPHY.cell} font-mono`}>
                {fieldValue}
              </td>
            </WindowTableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderValue(data: RedisKeyValueResponse, t: (key: string) => string) {
  const { type, value } = data;

  if (value === null) {
    return (
      <p className="mt-2 text-muted-foreground text-xs italic">
        {t('valueDisplayNotSupported')}
      </p>
    );
  }

  switch (type) {
    case 'string':
      if (typeof value === 'string') {
        return renderStringValue(value, t);
      }
      break;
    case 'set':
      if (Array.isArray(value)) {
        return renderSetValue(value, t);
      }
      break;
    case 'hash':
      if (typeof value === 'object' && !Array.isArray(value)) {
        return renderHashValue(value, t);
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
  const { t } = useTypedTranslation('admin');
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
        <Database className="h-4 w-4 text-destructive" />
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
              <span className="font-medium">{t('key')}:</span> {keyInfo.key}
            </p>
            <p>
              <span className="font-medium">{t('type')}:</span> {keyInfo.type}
            </p>
            <p>
              <span className="font-medium">{t('ttl')}:</span>{' '}
              {keyInfo.ttl === -1
                ? t('noExpiry')
                : keyInfo.ttl === -2
                  ? t('keyNotFound')
                  : `${keyInfo.ttl} seconds`}
            </p>
          </div>

          {loading && (
            <div className="flex items-center text-muted-foreground text-xs">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              {t('loadingValue')}
            </div>
          )}

          {error && (
            <div className="text-destructive text-xs">Error: {error}</div>
          )}

          {valueData && renderValue(valueData, t as (key: string) => string)}
        </div>
      )}
    </div>
  );
}
