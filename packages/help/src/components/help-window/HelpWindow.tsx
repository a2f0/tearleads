import { type HelpDocId } from '@help/constants/help';
import {
  DOCS_WINDOW_MAX_HEIGHT_PERCENT,
  DOCS_WINDOW_MAX_WIDTH_PERCENT,
  DOCS_WINDOW_MIN_HEIGHT,
  DOCS_WINDOW_MIN_WIDTH,
  getDocsWindowDefaults
} from '@help/lib/docsWindowSizing';
import { OPENAPI_JSON_PATH } from '@tearleads/ui';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar,
  WindowControlButton,
  WindowControlGroup,
  type WindowDimensions
} from '@tearleads/window-manager';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  HelpWindowContent,
  getHelpWindowTitle,
  type ApiSpec,
  type HelpView
} from './HelpWindowContent';
import { HelpWindowMenuBar } from './HelpWindowMenuBar';

function isApiSpec(value: unknown): value is ApiSpec {
  return typeof value === 'object' && value !== null && 'openapi' in value;
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
        const response = await fetch(OPENAPI_JSON_PATH);
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
          <HelpWindowContent
            view={view}
            openapiSpec={openapiSpec}
            apiDocsLoadFailed={apiDocsLoadFailed}
            onSetView={setView}
          />
        </div>
      </div>
    </FloatingWindow>
  );
}
