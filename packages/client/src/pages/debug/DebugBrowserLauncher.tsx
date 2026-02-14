import { IconSquare } from '@tearleads/ui';
import { Archive, Database, HardDrive } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';

export function DebugBrowserLauncher() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/debug" defaultLabel="Back to Debug" />
        <h1 className="font-bold text-2xl tracking-tight">Browser</h1>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:max-w-md lg:grid-cols-3">
        <IconSquare
          icon={Database}
          label="Local Storage"
          onClick={() => navigate('/debug/browser/local-storage')}
          data-testid="debug-browser-local-storage"
        />
        <IconSquare
          icon={HardDrive}
          label="OPFS"
          onClick={() => navigate('/debug/browser/opfs')}
          data-testid="debug-browser-opfs"
        />
        <IconSquare
          icon={Archive}
          label="Cache Storage"
          onClick={() => navigate('/debug/browser/cache-storage')}
          data-testid="debug-browser-cache-storage"
        />
      </div>
    </div>
  );
}
