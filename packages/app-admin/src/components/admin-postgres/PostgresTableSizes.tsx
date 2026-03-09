import { RefreshButton } from '@tearleads/ui';
import {
  WINDOW_TABLE_TYPOGRAPHY,
  WindowTableRow
} from '@tearleads/window-manager';
import { HardDrive } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTypedTranslation } from '@/i18n';
import { api } from '@/lib/api';

// component-complexity: allow -- table layout and routing split is tracked separately.
const ROW_COUNT_FORMATTER = new Intl.NumberFormat('en-US');
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

interface PostgresTableInfoView {
  schema: string;
  name: string;
  rowCount: bigint;
  totalBytes: bigint;
}

function toBigInt(value: bigint | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function formatBytes(bytes: bigint | number): string {
  const normalizedBytes = toBigInt(bytes);
  if (normalizedBytes === 0n) return '0B';

  let unitIndex = 0;
  let unitDivisor = 1n;

  while (
    normalizedBytes / unitDivisor >= 1024n &&
    unitIndex < BYTE_UNITS.length - 1
  ) {
    unitDivisor *= 1024n;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${normalizedBytes.toString()}B`;
  }

  const decimals = normalizedBytes / unitDivisor >= 10n ? 1 : 2;
  const scale = 10n ** BigInt(decimals);
  const roundedValue =
    (normalizedBytes * scale + unitDivisor / 2n) / unitDivisor;
  const wholePart = roundedValue / scale;
  const fractionPart = (roundedValue % scale)
    .toString()
    .padStart(decimals, '0');

  return `${wholePart.toString()}.${fractionPart}${BYTE_UNITS[unitIndex]}`;
}

function formatRowCount(count: bigint | number): string {
  const normalizedCount = toBigInt(count);
  return normalizedCount <= BigInt(Number.MAX_SAFE_INTEGER)
    ? ROW_COUNT_FORMATTER.format(Number(normalizedCount))
    : normalizedCount.toLocaleString('en-US');
}

function normalizePostgresTable(
  table: Awaited<
    ReturnType<typeof api.adminV2.postgres.getTables>
  >['tables'][number]
): PostgresTableInfoView {
  return {
    schema: table.schema,
    name: table.name,
    rowCount: toBigInt(table.rowCount),
    totalBytes: toBigInt(table.totalBytes)
  };
}

interface PostgresTableSizesProps {
  onTableSelect?: ((schema: string, tableName: string) => void) | undefined;
}

export function PostgresTableSizes({ onTableSelect }: PostgresTableSizesProps) {
  const { t } = useTypedTranslation('admin');
  const navigate = useNavigate();
  const [tables, setTables] = useState<PostgresTableInfoView[]>([]);
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
    () => tables.reduce((sum, table) => sum + toBigInt(table.totalBytes), 0n),
    [tables]
  );

  const fetchTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminV2.postgres.getTables();
      const sorted = response.tables
        .map(normalizePostgresTable)
        .sort((a, b) => {
          const schemaCompare = a.schema.localeCompare(b.schema, undefined, {
            sensitivity: 'base'
          });
          if (schemaCompare !== 0) return schemaCompare;
          return a.name.localeCompare(b.name, undefined, {
            sensitivity: 'base'
          });
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
      className="flex min-h-0 flex-1 flex-col space-y-3 rounded-lg border p-4"
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
        <div className="flex min-h-0 flex-1 flex-col space-y-2 text-sm">
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
            <div
              className="min-h-0 flex-1 overflow-auto rounded-lg border"
              data-testid="postgres-table-sizes-scroll-region"
            >
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
