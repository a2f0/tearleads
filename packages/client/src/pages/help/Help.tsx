import { CircleHelp, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackLink } from '@/components/ui/back-link';
import { GridSquare } from '@/components/ui/grid-square';

export function Help() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center gap-3">
          <CircleHelp className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Help</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <GridSquare onClick={() => navigate('/help/api')}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
            <FileText className="h-12 w-12 text-muted-foreground" />
            <span className="text-center font-medium text-sm">API Docs</span>
          </div>
        </GridSquare>
      </div>
    </div>
  );
}
