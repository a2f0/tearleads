import { PostgresTableRowsView } from '@admin/components/admin-postgres/PostgresTableRowsView';
import { useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';

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
