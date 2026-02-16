import { useState } from 'react';
import { BackLink } from '@client/components/ui/back-link';
import {
  DropdownMenu,
  DropdownMenuItem
} from '@client/components/ui/dropdown-menu';
import { useTypedTranslation } from '@client/i18n';
import { BackupDocumentation } from '../../components/backup-window/BackupDocumentation';
import { BackupManagerView } from '../../components/backup-window/BackupManagerView';

export interface BackupsProps {
  showBackLink?: boolean;
}

export function Backups({ showBackLink = true }: BackupsProps) {
  const { t: tMenu } = useTypedTranslation('menu');
  const [showDocumentation, setShowDocumentation] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">
            {tMenu('backups')}
          </h1>
        </div>
        <DropdownMenu trigger="Help" align="right">
          <DropdownMenuItem onClick={() => setShowDocumentation(true)}>
            Documentation
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
      <div className="space-y-6 rounded-lg border p-4">
        {showDocumentation ? (
          <BackupDocumentation onBack={() => setShowDocumentation(false)} />
        ) : (
          <BackupManagerView />
        )}
      </div>
    </div>
  );
}
