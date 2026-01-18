import { Database } from 'lucide-react';
import { DatabaseTest } from '@/components/sqlite/DatabaseTest';
import { TableSizes } from '@/components/sqlite/TableSizes';
import { BackLink } from '@/components/ui/back-link';

export function Sqlite() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center gap-3">
          <Database className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">SQLite</h1>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        Manage your encrypted SQLite database. Set up, unlock, lock, and reset
        your database here.
      </p>

      <DatabaseTest />

      <TableSizes />
    </div>
  );
}
