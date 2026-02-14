import { IconSquare } from '@tearleads/ui';
import { Bug, Globe, Monitor } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';

export function DebugLauncher() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center gap-3">
          <Bug className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Debug</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
        <IconSquare
          icon={Monitor}
          label="System Info"
          onClick={() => navigate('/debug/system-info')}
          data-testid="debug-launcher-system-info"
        />
        <IconSquare
          icon={Globe}
          label="Browser"
          onClick={() => navigate('/debug/browser')}
          data-testid="debug-launcher-browser"
        />
      </div>
    </div>
  );
}
