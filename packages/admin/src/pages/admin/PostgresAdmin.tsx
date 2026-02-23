import { PostgresConnectionPanel } from '@admin/components/admin-postgres/PostgresConnectionPanel';
import { PostgresTableSizes } from '@admin/components/admin-postgres/PostgresTableSizes';
import { BackLink } from '@tearleads/ui';
import { MemoryRouter, useInRouterContext } from 'react-router-dom';
import { useTypedTranslation } from '@/i18n';

interface PostgresAdminProps {
  showBackLink?: boolean;
  onTableSelect?: (schema: string, tableName: string) => void;
}

export function PostgresAdmin({
  showBackLink = true,
  onTableSelect
}: PostgresAdminProps) {
  const { t } = useTypedTranslation('admin');
  const inRouterContext = useInRouterContext();

  const content = (
    <div className="flex h-full min-h-0 flex-col space-y-6">
      <div className="space-y-2">
        {showBackLink && (
          <BackLink defaultTo="/" defaultLabel={t('backToHome')} />
        )}
        <div>
          <h1 className="font-bold text-2xl tracking-tight">
            {t('postgresAdmin')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('databaseManager')}
          </p>
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
