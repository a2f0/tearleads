import { Database } from 'lucide-react';
import { DatabaseTest } from '@/components/sqlite/DatabaseTest';

export function Sqlite() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-8 w-8 text-muted-foreground" />
        <h1 className="font-bold text-2xl tracking-tight">SQLite</h1>
      </div>

      <p className="text-muted-foreground text-sm">
        Manage your encrypted SQLite database. Set up, unlock, lock, and reset
        your database here.
      </p>

      <DatabaseTest />
    </div>
  );
}
