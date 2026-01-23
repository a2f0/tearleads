import openapiSpec from '@rapid/api/dist/openapi.json';
import { ApiDocs } from '@rapid/ui';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FloatingWindow } from '@/components/floating-window';
import {
  DOCS_WINDOW_MAX_HEIGHT_PERCENT,
  DOCS_WINDOW_MAX_WIDTH_PERCENT,
  DOCS_WINDOW_MIN_HEIGHT,
  DOCS_WINDOW_MIN_WIDTH,
  getDocsWindowDefaults
} from '@/lib/docsWindowSizing';

export function ApiDocsPage() {
  const navigate = useNavigate();
  const { defaultWidth, defaultHeight } = useMemo(() => {
    if (typeof window === 'undefined') {
      return getDocsWindowDefaults();
    }

    return getDocsWindowDefaults(window.innerWidth, window.innerHeight);
  }, []);

  return (
    <div className="relative min-h-[60vh]">
      <FloatingWindow
        id="api-docs"
        title="API Docs"
        onClose={() => navigate(-1)}
        defaultWidth={defaultWidth}
        defaultHeight={defaultHeight}
        minWidth={DOCS_WINDOW_MIN_WIDTH}
        minHeight={DOCS_WINDOW_MIN_HEIGHT}
        maxWidthPercent={DOCS_WINDOW_MAX_WIDTH_PERCENT}
        maxHeightPercent={DOCS_WINDOW_MAX_HEIGHT_PERCENT}
        zIndex={30}
      >
        <div className="h-full p-6">
          <ApiDocs spec={openapiSpec} />
        </div>
      </FloatingWindow>
    </div>
  );
}
