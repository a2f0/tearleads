import { IconSquare } from '@tearleads/ui';
import { BookText, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackLink } from '@tearleads/ui';
import { getComplianceFrameworks } from '../../lib/complianceCatalog';

export function Compliance() {
  const navigate = useNavigate();
  const frameworks = getComplianceFrameworks();

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Compliance</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Browse regulatory policy indexes, mapped policies, procedures, and
          technical control docs.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {frameworks.map((framework) => (
          <IconSquare
            key={framework.id}
            icon={BookText}
            label={framework.label}
            onClick={() => navigate(framework.defaultRoutePath)}
          />
        ))}
      </div>
    </div>
  );
}
