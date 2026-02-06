import { BackupManagerView } from '@/components/backup-window/BackupManagerView';
import { BackLink } from '@/components/ui/back-link';
import { useTypedTranslation } from '@/i18n';

interface BackupsProps {
  showBackLink?: boolean;
}

export function Backups({ showBackLink = true }: BackupsProps) {
  const { t: tMenu } = useTypedTranslation('menu');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {showBackLink && <BackLink defaultTo="/" defaultLabel="Back to Home" />}
        <h1 className="font-bold text-2xl tracking-tight">
          {tMenu('backups')}
        </h1>
      </div>
      <div className="space-y-6 rounded-lg border p-4">
        <BackupManagerView />
      </div>
    </div>
  );
}
