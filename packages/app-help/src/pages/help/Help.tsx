import { getHelpDocRouteSegment } from '@help/constants/help';
import { BackLink } from '@tearleads/ui';
import { CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpLinksGrid } from '../../components/help-links/HelpLinksGrid';

export function Help() {
  const navigate = useNavigate();
  const [view, setView] = useState<'topLevel' | 'developer' | 'legal'>(
    'topLevel'
  );

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center gap-3">
          <CircleHelp className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Help</h1>
        </div>
      </div>

      {view === 'topLevel' ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          <HelpLinksGrid
            view="topLevel"
            onApiDocsClick={() => navigate('/help/api')}
            onDeveloperClick={() => setView('developer')}
            onLegalClick={() => setView('legal')}
            onDocClick={(docId) =>
              navigate(`/help/docs/${getHelpDocRouteSegment(docId)}`)
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => setView('topLevel')}
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            Back to Help
          </button>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            <HelpLinksGrid
              view={view}
              onApiDocsClick={() => navigate('/help/api')}
              onDeveloperClick={() => setView('developer')}
              onLegalClick={() => setView('legal')}
              onDocClick={(docId) =>
                navigate(`/help/docs/${getHelpDocRouteSegment(docId)}`)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
