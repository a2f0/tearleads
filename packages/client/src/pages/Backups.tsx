import { useState } from 'react';

import { CreateBackupTab, RestoreBackupTab } from '@/components/backup-window';
import { BackLink } from '@/components/ui/back-link';
import { cn } from '@/lib/utils';

type Tab = 'create' | 'restore';

interface BackupsProps {
  showBackLink?: boolean;
}

export function Backups({ showBackLink = true }: BackupsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('create');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <h1 className="font-bold text-2xl tracking-tight">Backups</h1>
      </div>

      <div className="rounded-lg border p-4">
        <div className="mb-4 flex gap-2 border-zinc-700 border-b pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              activeTab === 'create'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('restore')}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              activeTab === 'restore'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            Restore
          </button>
        </div>

        {activeTab === 'create' && <CreateBackupTab />}
        {activeTab === 'restore' && <RestoreBackupTab />}
      </div>
    </div>
  );
}
