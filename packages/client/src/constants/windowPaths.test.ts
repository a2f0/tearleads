import { describe, expect, it } from 'vitest';
import { navItems } from '@/components/Sidebar';
import { WINDOW_PATHS } from './windowPaths';

const adminFlyoutPaths = ['/admin/redis', '/admin/postgres', '/admin/groups'];

describe('WINDOW_PATHS', () => {
  it('includes every sidebar launcher path', () => {
    const launcherPaths = navItems
      .filter((item) => item.path !== '/')
      .map((item) => item.path);

    for (const path of launcherPaths) {
      expect(WINDOW_PATHS[path]).toBeTruthy();
    }
  });

  it('includes admin flyout window routes', () => {
    for (const path of adminFlyoutPaths) {
      expect(WINDOW_PATHS[path]).toBeTruthy();
    }
  });
});
