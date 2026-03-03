import { getHelpDocLabel, type HelpDocId } from '@help/constants/help';
import { ApiDocs } from '@tearleads/ui';
import { CircleHelp } from 'lucide-react';
import type { ComponentProps } from 'react';
import { HelpDocumentation } from '../help-links/HelpDocumentation';
import { HelpLinksGrid } from '../help-links/HelpLinksGrid';

export type HelpView = 'index' | 'developer' | 'legal' | 'api' | HelpDocId;
export type ApiSpec = ComponentProps<typeof ApiDocs>['spec'];

function resolveHelpWindowTitle(view: HelpView): string {
  switch (view) {
    case 'index':
      return 'Help';
    case 'api':
      return 'API Docs';
    case 'developer':
      return 'Developer';
    case 'legal':
      return 'Legal';
    default:
      return getHelpDocLabel(view);
  }
}

interface HelpWindowContentProps {
  view: HelpView;
  openapiSpec: ApiSpec | null;
  apiDocsLoadFailed: boolean;
  onSetView: (nextView: HelpView) => void;
}

export function HelpWindowContent({
  view,
  openapiSpec,
  apiDocsLoadFailed,
  onSetView
}: HelpWindowContentProps) {
  if (view === 'index') {
    return (
      <div className="h-full space-y-6 overflow-auto">
        <div className="flex items-center gap-3">
          <CircleHelp className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Help</h1>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          <HelpLinksGrid
            view="topLevel"
            onApiDocsClick={() => onSetView('api')}
            onDeveloperClick={() => onSetView('developer')}
            onLegalClick={() => onSetView('legal')}
            onDocClick={onSetView}
          />
        </div>
      </div>
    );
  }

  if (view === 'developer' || view === 'legal') {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          <HelpLinksGrid
            view={view}
            onApiDocsClick={() => onSetView('api')}
            onDeveloperClick={() => onSetView('developer')}
            onLegalClick={() => onSetView('legal')}
            onDocClick={onSetView}
          />
        </div>
      </div>
    );
  }

  if (view === 'api') {
    return (
      <div className="h-full overflow-auto">
        {openapiSpec ? (
          <ApiDocs spec={openapiSpec} />
        ) : apiDocsLoadFailed ? (
          <div className="text-danger text-sm">Unable to load API docs.</div>
        ) : (
          <div className="text-muted-foreground text-sm">
            Loading API docs...
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <HelpDocumentation docId={view} />
      </div>
    </div>
  );
}

export function getHelpWindowTitle(view: HelpView): string {
  return resolveHelpWindowTitle(view);
}
