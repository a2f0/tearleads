import { MemoryRouter, useInRouterContext } from 'react-router-dom';
import { PostgresConnectionPanel } from '@admin/components/admin-postgres/PostgresConnectionPanel';
import { PostgresTableSizes } from '@admin/components/admin-postgres/PostgresTableSizes';
import { BackLink } from '@/components/ui/back-link';

interface PostgresAdminProps {
  showBackLink?: boolean;
  onTableSelect?: (schema: string, tableName: string) => void;
}

export function PostgresAdmin({
  showBackLink = true,
  onTableSelect
}: PostgresAdminProps) {
  const inRouterContext = useInRouterContext();

  const content = (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Postgres Admin</h1>
          <p className="text-muted-foreground text-sm">Database manager</p>
        </div>
      </div>
      <PostgresConnectionPanel />
      <PostgresTableSizes onTableSelect={onTableSelect} />
    </div>
  );

  return inRouterContext ? (
    content
  ) : (
    <MemoryRouter initialEntries={['/admin/postgres']}>{content}</MemoryRouter>
  );
}
