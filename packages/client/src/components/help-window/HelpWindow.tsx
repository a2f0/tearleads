import openapiSpec from '@tearleads/api/dist/openapi.json';
import { ApiDocs } from '@tearleads/ui';
import { ArrowLeft, CircleHelp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { HelpDocumentation } from '@/components/help-links/HelpDocumentation';
import { HelpLinksGrid } from '@/components/help-links/HelpLinksGrid';
import { getHelpDocLabel, type HelpDocId } from '@/constants/help';
import {
  DOCS_WINDOW_MAX_HEIGHT_PERCENT,
  DOCS_WINDOW_MAX_WIDTH_PERCENT,
  DOCS_WINDOW_MIN_HEIGHT,
  DOCS_WINDOW_MIN_WIDTH,
  getDocsWindowDefaults
} from '@/lib/docsWindowSizing';
import { HelpWindowMenuBar } from './HelpWindowMenuBar';

type HelpView = 'index' | 'api' | HelpDocId;

function getHelpWindowTitle(view: HelpView): string {
  switch (view) {
    case 'index':
      return 'Help';
    case 'api':
      return 'API Docs';
    default:
      return getHelpDocLabel(view);
  }
}

interface HelpWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: (dimensions: WindowDimensions) => void;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions;
}

export function HelpWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: HelpWindowProps) {
  const [view, setView] = useState<HelpView>('index');

  const { defaultWidth, defaultHeight } = useMemo(() => {
    if (typeof window === 'undefined') {
      return getDocsWindowDefaults();
    }

    return getDocsWindowDefaults(window.innerWidth, window.innerHeight);
  }, []);

  const title = getHelpWindowTitle(view);

  return (
    <FloatingWindow
      id={id}
      title={title}
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={defaultWidth}
      defaultHeight={defaultHeight}
      minWidth={DOCS_WINDOW_MIN_WIDTH}
      minHeight={DOCS_WINDOW_MIN_HEIGHT}
      maxWidthPercent={DOCS_WINDOW_MAX_WIDTH_PERCENT}
      maxHeightPercent={DOCS_WINDOW_MAX_HEIGHT_PERCENT}
      contentClassName="overflow-hidden"
    >
      <div className="flex h-full flex-col overflow-hidden">
        <HelpWindowMenuBar onClose={onClose} />
        <div className="min-h-0 flex-1 p-6">
          {view === 'index' ? (
            <div className="h-full space-y-6 overflow-auto">
              <div className="flex items-center gap-3">
                <CircleHelp className="h-8 w-8 text-muted-foreground" />
                <h1 className="font-bold text-2xl tracking-tight">Help</h1>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                <HelpLinksGrid
                  onApiDocsClick={() => setView('api')}
                  onDocClick={(docId) => setView(docId)}
                />
              </div>
            </div>
          ) : view === 'api' ? (
            <div className="h-full space-y-6 overflow-auto">
              <button
                type="button"
                onClick={() => setView('index')}
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Help
              </button>
              <ApiDocs spec={openapiSpec} />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
              <button
                type="button"
                onClick={() => setView('index')}
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Help
              </button>
              <div className="min-h-0 flex-1">
                <HelpDocumentation docId={view} />
              </div>
            </div>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
