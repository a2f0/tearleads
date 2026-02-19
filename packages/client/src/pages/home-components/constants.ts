/**
 * Constants for Home page.
 */

import { navItems } from '@/components/Sidebar';
import { WINDOW_PATHS } from '@/constants/windowPaths';
import type { WindowType } from '@/contexts/WindowManagerContext';

// AGENT GUARDRAIL: When adding a new window path, ensure parity with:
// - constants/windowPaths.ts WINDOW_PATHS mapping
// - WindowManagerContext.tsx WindowType union
// - WindowRenderer.tsx switch cases
export const PATH_TO_WINDOW_TYPE: Partial<Record<string, WindowType>> = {};
for (const item of navItems) {
  if (item.path === '/') continue;
  const windowType = WINDOW_PATHS[item.path];
  if (windowType) {
    PATH_TO_WINDOW_TYPE[item.path] = windowType;
  }
}

export const MOBILE_COLUMNS = 4;
export const STORAGE_KEY = 'desktop-icon-positions';
