import { AdminOptionsGrid } from '@admin/components/admin';
import { Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';

export function AdminLauncher() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Admin</h1>
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
