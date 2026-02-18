import { AdminOptionsGrid } from '@admin/components/admin';
import { BackLink } from '@tearleads/ui';
import { Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTypedTranslation } from '@/i18n';

export function AdminLauncher() {
  const { t } = useTypedTranslation('admin');
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel={t('backToHome')} />
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">{t('admin')}</h1>
        </div>
      </div>

      <AdminOptionsGrid
        onSelect={(id) =>
          navigate(id === 'compliance' ? '/compliance' : `/admin/${id}`)
        }
        gridClassName="lg:grid-cols-6"
      />
    </div>
  );
}
