import { CircleHelp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { HelpLinksGrid } from '@/components/help-links/HelpLinksGrid';
import { BackLink } from '@/components/ui/back-link';
import { getHelpDocRouteSegment } from '@/constants/help';

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
        <HelpLinksGrid
          onApiDocsClick={() => navigate('/help/api')}
          onDocClick={(docId) =>
            navigate(`/help/docs/${getHelpDocRouteSegment(docId)}`)
          }
        />
      </div>
    </div>
  );
}
