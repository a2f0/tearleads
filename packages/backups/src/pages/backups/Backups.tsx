import {
  BackLink,
  DropdownMenu,
  DropdownMenuItem
} from '@tearleads/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackupDocumentation } from '../../components/backup-window/BackupDocumentation';
import { BackupManagerView } from '../../components/backup-window/BackupManagerView';

export interface BackupsProps {
  showBackLink?: boolean;
}

export function Backups({ showBackLink = true }: BackupsProps) {
  const { t } = useTranslation();
  const [showDocumentation, setShowDocumentation] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          {showBackLink && (
            <BackLink defaultTo="/" defaultLabel="Back to Home" />
          )}
          <h1 className="font-bold text-2xl tracking-tight">
            {t('menu:backups')}
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
