import { PostgresConnectionPanel } from '@/components/admin-postgres/PostgresConnectionPanel';
import { PostgresTableSizes } from '@/components/admin-postgres/PostgresTableSizes';
import { BackLink } from '@/components/ui/back-link';

export function PostgresAdmin() {
  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Postgres Admin</h1>
          <p className="text-muted-foreground text-sm">Database manager</p>
        </div>
      </div>
      <PostgresConnectionPanel />
      <PostgresTableSizes />
    </div>
  );
}
