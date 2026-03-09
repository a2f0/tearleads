import { PostgresTableRowsView } from '@admin/components/admin-postgres/PostgresTableRowsView';
import { BackLink } from '@tearleads/ui';
import { useParams } from 'react-router-dom';

export function PostgresTableRows() {
  const { schema, tableName } = useParams<{
    schema: string;
    tableName: string;
  }>();

  return (
    <PostgresTableRowsView
      key={`${schema ?? 'unknown'}.${tableName ?? 'unknown'}`}
      schema={schema ?? null}
      tableName={tableName ?? null}
      backLink={
        <BackLink defaultTo="/admin/postgres" defaultLabel="Back to Postgres" />
      }
    />
  );
}
