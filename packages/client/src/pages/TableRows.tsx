import { useParams } from 'react-router-dom';
import { TableRowsView } from '@/components/sqlite/TableRowsView';
import { BackLink } from '@/components/ui/back-link';

export function TableRows() {
  const { tableName } = useParams<{ tableName: string }>();

  return (
    <TableRowsView
      key={tableName ?? 'unknown'}
      tableName={tableName ?? null}
      backLink={
        <BackLink defaultTo="/sqlite/tables" defaultLabel="Back to Tables" />
      }
    />
  );
}
