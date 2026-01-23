import openapiSpec from '@rapid/api/dist/openapi.json';
import { ApiDocs } from '@rapid/ui';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FloatingWindow } from '@/components/floating-window';

const DEFAULT_WINDOW_WIDTH = 960;
const DEFAULT_WINDOW_HEIGHT = 720;
const WINDOW_GUTTER = 120;
const WINDOW_VERTICAL_GUTTER = 180;
const MIN_WINDOW_WIDTH = 360;
const MIN_WINDOW_HEIGHT = 320;

export function ApiDocsPage() {
  const navigate = useNavigate();
  const { defaultWidth, defaultHeight } = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        defaultWidth: DEFAULT_WINDOW_WIDTH,
        defaultHeight: DEFAULT_WINDOW_HEIGHT
      };
    }

    const width = Math.max(
      MIN_WINDOW_WIDTH,
      Math.min(DEFAULT_WINDOW_WIDTH, window.innerWidth - WINDOW_GUTTER)
    );
    const height = Math.max(
      MIN_WINDOW_HEIGHT,
      Math.min(
        DEFAULT_WINDOW_HEIGHT,
        window.innerHeight - WINDOW_VERTICAL_GUTTER
      )
    );

    return { defaultWidth: width, defaultHeight: height };
  }, []);

  return (
    <div className="relative min-h-[60vh]">
      <FloatingWindow
        id="api-docs"
        title="API Docs"
        onClose={() => navigate(-1)}
        defaultWidth={defaultWidth}
        defaultHeight={defaultHeight}
        minWidth={MIN_WINDOW_WIDTH}
        minHeight={MIN_WINDOW_HEIGHT}
        maxWidthPercent={0.9}
        maxHeightPercent={0.85}
        zIndex={30}
      >
        <div className="h-full p-6">
          <ApiDocs spec={openapiSpec} />
        </div>
      </FloatingWindow>
    </div>
  );
}
