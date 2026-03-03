import { lazy, Suspense } from 'react';
import { useWindowManager } from '@/contexts/WindowManagerContext';

const DeferredWindowRenderer = lazy(() =>
  import('./WindowRenderer').then((module) => ({
    default: module.WindowRenderer
  }))
);

export function LazyWindowRenderer() {
  const { windows } = useWindowManager();
  const hasVisibleWindows = windows.some((window) => !window.isMinimized);

  if (!hasVisibleWindows) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <DeferredWindowRenderer />
    </Suspense>
  );
}
