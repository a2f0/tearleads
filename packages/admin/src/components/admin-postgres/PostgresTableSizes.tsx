import type { PostgresTableInfo } from '@tearleads/shared';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { HardDrive } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshButton } from '@tearleads/ui';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';

const ROW_COUNT_FORMATTER = new Intl.NumberFormat('en-US');

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / k ** index;
  return `${value.toFixed(value >= 10 ? 1 : 2)}${sizes[index]}`;
}

function formatRowCount(count: number): string {
  return ROW_COUNT_FORMATTER.format(count);
}

interface PostgresTableSizesProps {
  onTableSelect?: ((schema: string, tableName: string) => void) | undefined;
}

export function PostgresTableSizes({ onTableSelect }: PostgresTableSizesProps) {
  const { t } = useTypedTranslation('admin');
  const navigate = useNavigate();
  const [tables, setTables] = useState<PostgresTableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTableClick = useCallback(
    (schema: string, name: string) => {
      if (onTableSelect) {
        onTableSelect(schema, name);
      } else {
        navigate(
          `/admin/postgres/tables/${encodeURIComponent(schema)}/${encodeURIComponent(name)}`
        );
      }
    },
    [onTableSelect, navigate]
  );

  const totalBytes = useMemo(
    () => tables.reduce((sum, table) => sum + table.totalBytes, 0),
    [tables]
  );

  const fetchTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.admin.postgres.getTables();
      const sorted = [...response.tables].sort((a, b) => {
        const schemaCompare = a.schema.localeCompare(b.schema, undefined, {
          sensitivity: 'base'
        });
        if (schemaCompare !== 0) return schemaCompare;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setTables(sorted);
    } catch (err) {
      console.error('Failed to fetch Postgres tables:', err);
      setError(err instanceof Error ? err.message : String(err));
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  return (
    <div
      className="space-y-3 rounded-lg border p-4"
      data-testid="postgres-table-sizes"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t('tableSummary')}</h2>
        <RefreshButton
          onClick={fetchTables}
          loading={loading}
          variant="ghost"
          className="h-8 w-8"
        />
      </div>

      {error && <div className="text-destructive text-sm">{error}</div>}

      {!error && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{t('totalDatabase')}</span>
            </div>
            <span className="font-mono">{formatBytes(totalBytes)}</span>
          </div>

          {loading && tables.length === 0 ? (
            <div className="py-2 text-center text-muted-foreground">
              Loading...
            </div>
          ) : tables.length === 0 ? (
            <div className="py-2 text-center text-muted-foreground">
              No tables found
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border">
              <table className={WINDOW_TABLE_TYPOGRAPHY.table}>
                <thead className={WINDOW_TABLE_TYPOGRAPHY.header}>
                  <tr>
                    <th className={WINDOW_TABLE_TYPOGRAPHY.headerCell}>
                      Table
                    </th>
                    <th
                      className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}
                    >
                      Size
                    </th>
                    <th
                      className={`${WINDOW_TABLE_TYPOGRAPHY.headerCell} text-right`}
                    >
                      Rows
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((table) => {
                    const label = `${table.schema}.${table.name}`;
                    return (
                      <WindowTableRow
                        key={label}
                        onClick={() =>
                          handleTableClick(table.schema, table.name)
                        }
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleTableClick(table.schema, table.name);
                          }
                        }}
                      >
                        <td className={WINDOW_TABLE_TYPOGRAPHY.cell}>
                          <span className="font-mono text-muted-foreground">
                            {label}
                          </span>
                        </td>
                        <td
                          className={`${WINDOW_TABLE_TYPOGRAPHY.mutedCell} text-right font-mono`}
                        >
                          {formatBytes(table.totalBytes)}
                        </td>
                        <td
                          className={`${WINDOW_TABLE_TYPOGRAPHY.mutedCell} text-right font-mono`}
                        >
                          {formatRowCount(table.rowCount)}
                        </td>
                      </WindowTableRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
