import { getHelpDocLabel, type HelpDocId } from '@help/constants/help';
import {
  DOCS_WINDOW_MAX_HEIGHT_PERCENT,
  DOCS_WINDOW_MAX_WIDTH_PERCENT,
  DOCS_WINDOW_MIN_HEIGHT,
  DOCS_WINDOW_MIN_WIDTH,
  getDocsWindowDefaults
} from '@help/lib/docsWindowSizing';
import { ApiDocs } from '@tearleads/ui';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft, CircleHelp } from 'lucide-react';
import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { HelpDocumentation } from '../help-links/HelpDocumentation';
import { HelpLinksGrid } from '../help-links/HelpLinksGrid';
import { HelpWindowMenuBar } from './HelpWindowMenuBar';

type HelpView = 'index' | 'developer' | 'legal' | 'api' | HelpDocId;
type ApiSpec = ComponentProps<typeof ApiDocs>['spec'];

function isApiSpec(value: unknown): value is ApiSpec {
  return typeof value === 'object' && value !== null && 'openapi' in value;
}

function getHelpWindowTitle(view: HelpView): string {
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

interface HelpWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
  openHelpDocId?: HelpDocId | null | undefined;
  openRequestId?: number | undefined;
}

export function HelpWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  openHelpDocId,
  openRequestId
}: HelpWindowProps) {
  const [view, setView] = useState<HelpView>('index');
  const [openapiSpec, setOpenapiSpec] = useState<ApiSpec | null>(null);
  const [apiDocsLoadFailed, setApiDocsLoadFailed] = useState(false);

  // Navigate to a specific help doc when requested from another window
  useEffect(() => {
    if (!openRequestId || !openHelpDocId) return;
    setView(openHelpDocId);
  }, [openHelpDocId, openRequestId]);

  useEffect(() => {
    if (view !== 'api' || openapiSpec) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/v1/openapi.json');
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setApiDocsLoadFailed(true);
          return;
        }

        const spec: unknown = await response.json();
        if (cancelled) {
          return;
        }
        if (isApiSpec(spec)) {
          setOpenapiSpec(spec);
          return;
        }

        setApiDocsLoadFailed(true);
      } catch {
        if (!cancelled) {
          setApiDocsLoadFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openapiSpec, view]);

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
      onRename={onRename}
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
        <WindowControlBar>
          <WindowControlGroup>
            {view !== 'index' && (
              <WindowControlButton
                icon={<ArrowLeft className="h-3 w-3" />}
                onClick={() => setView('index')}
                data-testid="help-window-control-back"
              >
                Back
              </WindowControlButton>
            )}
          </WindowControlGroup>
        </WindowControlBar>
        <div className="min-h-0 flex-1 p-6">
          {view === 'index' ? (
            <div className="h-full space-y-6 overflow-auto">
              <div className="flex items-center gap-3">
                <CircleHelp className="h-8 w-8 text-muted-foreground" />
                <h1 className="font-bold text-2xl tracking-tight">Help</h1>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                <HelpLinksGrid
                  view="topLevel"
                  onApiDocsClick={() => setView('api')}
                  onDeveloperClick={() => setView('developer')}
                  onLegalClick={() => setView('legal')}
                  onDocClick={(docId) => setView(docId)}
                />
              </div>
            </div>
          ) : view === 'developer' || view === 'legal' ? (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                <HelpLinksGrid
                  view={view}
                  onApiDocsClick={() => setView('api')}
                  onDeveloperClick={() => setView('developer')}
                  onLegalClick={() => setView('legal')}
                  onDocClick={(docId) => setView(docId)}
                />
              </div>
            </div>
          ) : view === 'api' ? (
            <div className="h-full overflow-auto">
              {openapiSpec ? (
                <ApiDocs spec={openapiSpec} />
              ) : apiDocsLoadFailed ? (
                <div className="text-danger text-sm">
                  Unable to load API docs.
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">
                  Loading API docs...
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
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
