import type { WindowDimensions } from './windowRendererTestHarness';

export type WindowClickCase = [
  label: string,
  type: string,
  id: string,
  testId: string
];

export type WindowMinimizeCase = [
  label: string,
  type: string,
  id: string,
  testId: string,
  dimensions: WindowDimensions
];

interface WindowCase {
  label: string;
  type: string;
  id: string;
  windowTestId: string;
  closeTestId: string;
  focusTestId?: string;
  minimize?: {
    testId: string;
    dimensions: WindowDimensions;
  };
}

export function hasFocusTestId(
  windowCase: WindowCase
): windowCase is WindowCase & { focusTestId: string } {
  return Boolean(windowCase.focusTestId);
}

export function hasMinimizeCase(
  windowCase: WindowCase
): windowCase is WindowCase & {
  minimize: { testId: string; dimensions: WindowDimensions };
} {
  return Boolean(windowCase.minimize);
}

export const windowCases: WindowCase[] = [
  {
    label: 'notes',
    type: 'notes',
    id: 'notes-1',
    windowTestId: 'notes-window-notes-1',
    closeTestId: 'close-notes-1',
    focusTestId: 'notes-window-notes-1',
    minimize: {
      testId: 'minimize-notes-1',
      dimensions: { x: 0, y: 0, width: 400, height: 300 }
    }
  },
  {
    label: 'console',
    type: 'console',
    id: 'console-1',
    windowTestId: 'console-window-console-1',
    closeTestId: 'close-console-1',
    minimize: {
      testId: 'minimize-console-1',
      dimensions: { x: 0, y: 0, width: 600, height: 400 }
    }
  },
  {
    label: 'settings',
    type: 'settings',
    id: 'settings-1',
    windowTestId: 'settings-window-settings-1',
    closeTestId: 'close-settings-1'
  },
  {
    label: 'email',
    type: 'email',
    id: 'email-1',
    windowTestId: 'email-window-email-1',
    closeTestId: 'close-email-1',
    focusTestId: 'email-window-email-1',
    minimize: {
      testId: 'minimize-email-1',
      dimensions: { x: 0, y: 0, width: 550, height: 450 }
    }
  },
  {
    label: 'files',
    type: 'files',
    id: 'files-1',
    windowTestId: 'files-window-files-1',
    closeTestId: 'close-files-1',
    focusTestId: 'files-window-files-1',
    minimize: {
      testId: 'minimize-files-1',
      dimensions: { x: 0, y: 0, width: 500, height: 400 }
    }
  },
  {
    label: 'tables',
    type: 'tables',
    id: 'tables-1',
    windowTestId: 'tables-window-tables-1',
    closeTestId: 'close-tables-1',
    focusTestId: 'tables-window-tables-1',
    minimize: {
      testId: 'minimize-tables-1',
      dimensions: { x: 0, y: 0, width: 850, height: 600 }
    }
  },
  {
    label: 'debug',
    type: 'debug',
    id: 'debug-1',
    windowTestId: 'debug-window-debug-1',
    closeTestId: 'close-debug-1',
    focusTestId: 'debug-window-debug-1',
    minimize: {
      testId: 'minimize-debug-1',
      dimensions: { x: 0, y: 0, width: 600, height: 500 }
    }
  },
  {
    label: 'documents',
    type: 'documents',
    id: 'documents-1',
    windowTestId: 'documents-window-documents-1',
    closeTestId: 'close-documents-1',
    focusTestId: 'documents-window-documents-1',
    minimize: {
      testId: 'minimize-documents-1',
      dimensions: { x: 0, y: 0, width: 700, height: 550 }
    }
  },
  {
    label: 'videos',
    type: 'videos',
    id: 'videos-1',
    windowTestId: 'video-window-videos-1',
    closeTestId: 'close-videos-1',
    focusTestId: 'video-window-videos-1',
    minimize: {
      testId: 'minimize-videos-1',
      dimensions: { x: 0, y: 0, width: 650, height: 500 }
    }
  },
  {
    label: 'photos',
    type: 'photos',
    id: 'photos-1',
    windowTestId: 'photos-window-photos-1',
    closeTestId: 'close-photos-1',
    focusTestId: 'photos-window-photos-1',
    minimize: {
      testId: 'minimize-photos-1',
      dimensions: { x: 0, y: 0, width: 700, height: 550 }
    }
  },
  {
    label: 'camera',
    type: 'camera',
    id: 'camera-1',
    windowTestId: 'camera-window-camera-1',
    closeTestId: 'close-camera-1',
    focusTestId: 'camera-window-camera-1',
    minimize: {
      testId: 'minimize-camera-1',
      dimensions: { x: 0, y: 0, width: 840, height: 620 }
    }
  },
  {
    label: 'models',
    type: 'models',
    id: 'models-1',
    windowTestId: 'models-window-models-1',
    closeTestId: 'close-models-1',
    focusTestId: 'models-window-models-1',
    minimize: {
      testId: 'minimize-models-1',
      dimensions: { x: 0, y: 0, width: 720, height: 600 }
    }
  },
  {
    label: 'keychain',
    type: 'keychain',
    id: 'keychain-1',
    windowTestId: 'keychain-window-keychain-1',
    closeTestId: 'close-keychain-1',
    focusTestId: 'keychain-window-keychain-1',
    minimize: {
      testId: 'minimize-keychain-1',
      dimensions: { x: 0, y: 0, width: 600, height: 500 }
    }
  },
  {
    label: 'wallet',
    type: 'wallet',
    id: 'wallet-1',
    windowTestId: 'wallet-window-wallet-1',
    closeTestId: 'close-wallet-1',
    focusTestId: 'wallet-window-wallet-1',
    minimize: {
      testId: 'minimize-wallet-1',
      dimensions: { x: 0, y: 0, width: 760, height: 560 }
    }
  },
  {
    label: 'contacts',
    type: 'contacts',
    id: 'contacts-1',
    windowTestId: 'contacts-window-contacts-1',
    closeTestId: 'close-contacts-1',
    focusTestId: 'contacts-window-contacts-1',
    minimize: {
      testId: 'minimize-contacts-1',
      dimensions: { x: 0, y: 0, width: 600, height: 500 }
    }
  },
  {
    label: 'sqlite',
    type: 'sqlite',
    id: 'sqlite-1',
    windowTestId: 'sqlite-window-sqlite-1',
    closeTestId: 'close-sqlite-1',
    focusTestId: 'sqlite-window-sqlite-1',
    minimize: {
      testId: 'minimize-sqlite-1',
      dimensions: { x: 0, y: 0, width: 600, height: 500 }
    }
  },
  {
    label: 'sync',
    type: 'sync',
    id: 'sync-1',
    windowTestId: 'sync-window-sync-1',
    closeTestId: 'close-sync-1',
    focusTestId: 'sync-window-sync-1',
    minimize: {
      testId: 'minimize-sync-1',
      dimensions: { x: 0, y: 0, width: 400, height: 450 }
    }
  },
  {
    label: 'opfs',
    type: 'opfs',
    id: 'opfs-1',
    windowTestId: 'opfs-window-opfs-1',
    closeTestId: 'close-opfs-1',
    minimize: {
      testId: 'minimize-opfs-1',
      dimensions: { x: 0, y: 0, width: 720, height: 560 }
    }
  },
  {
    label: 'local storage',
    type: 'local-storage',
    id: 'local-storage-1',
    windowTestId: 'local-storage-window-local-storage-1',
    closeTestId: 'close-local-storage-1',
    focusTestId: 'local-storage-window-local-storage-1',
    minimize: {
      testId: 'minimize-local-storage-1',
      dimensions: { x: 0, y: 0, width: 520, height: 420 }
    }
  },
  {
    label: 'analytics',
    type: 'analytics',
    id: 'analytics-1',
    windowTestId: 'analytics-window-analytics-1',
    closeTestId: 'close-analytics-1',
    focusTestId: 'analytics-window-analytics-1',
    minimize: {
      testId: 'minimize-analytics-1',
      dimensions: { x: 0, y: 0, width: 700, height: 550 }
    }
  },
  {
    label: 'audio',
    type: 'audio',
    id: 'audio-1',
    windowTestId: 'audio-window-audio-1',
    closeTestId: 'close-audio-1',
    focusTestId: 'audio-window-audio-1',
    minimize: {
      testId: 'minimize-audio-1',
      dimensions: { x: 0, y: 0, width: 600, height: 500 }
    }
  },
  {
    label: 'admin',
    type: 'admin',
    id: 'admin-1',
    windowTestId: 'admin-window-admin-1',
    closeTestId: 'close-admin-1',
    focusTestId: 'admin-window-admin-1',
    minimize: {
      testId: 'minimize-admin-1',
      dimensions: { x: 0, y: 0, width: 700, height: 600 }
    }
  },
  {
    label: 'admin users',
    type: 'admin-users',
    id: 'admin-users-1',
    windowTestId: 'admin-users-window-admin-users-1',
    closeTestId: 'close-admin-users-1',
    focusTestId: 'admin-users-window-admin-users-1',
    minimize: {
      testId: 'minimize-admin-users-1',
      dimensions: { x: 0, y: 0, width: 840, height: 620 }
    }
  },
  {
    label: 'admin organizations',
    type: 'admin-organizations',
    id: 'admin-organizations-1',
    windowTestId: 'admin-organizations-window-admin-organizations-1',
    closeTestId: 'close-admin-organizations-1',
    focusTestId: 'admin-organizations-window-admin-organizations-1',
    minimize: {
      testId: 'minimize-admin-organizations-1',
      dimensions: { x: 0, y: 0, width: 840, height: 620 }
    }
  },
  {
    label: 'calendar',
    type: 'calendar',
    id: 'calendar-1',
    windowTestId: 'calendar-window-calendar-1',
    closeTestId: 'close-calendar-1',
    focusTestId: 'calendar-window-calendar-1',
    minimize: {
      testId: 'minimize-calendar-1',
      dimensions: { x: 0, y: 0, width: 900, height: 640 }
    }
  },
  {
    label: 'businesses',
    type: 'businesses',
    id: 'businesses-1',
    windowTestId: 'businesses-window-businesses-1',
    closeTestId: 'close-businesses-1',
    focusTestId: 'businesses-window-businesses-1',
    minimize: {
      testId: 'minimize-businesses-1',
      dimensions: { x: 0, y: 0, width: 860, height: 560 }
    }
  },
  {
    label: 'vehicles',
    type: 'vehicles',
    id: 'vehicles-1',
    windowTestId: 'vehicles-window-vehicles-1',
    closeTestId: 'close-vehicles-1',
    focusTestId: 'vehicles-window-vehicles-1',
    minimize: {
      testId: 'minimize-vehicles-1',
      dimensions: { x: 0, y: 0, width: 900, height: 620 }
    }
  },
  {
    label: 'health',
    type: 'health',
    id: 'health-1',
    windowTestId: 'health-window-health-1',
    closeTestId: 'close-health-1',
    focusTestId: 'health-window-health-1',
    minimize: {
      testId: 'minimize-health-1',
      dimensions: { x: 0, y: 0, width: 760, height: 560 }
    }
  },
  {
    label: 'ai',
    type: 'ai',
    id: 'ai-1',
    windowTestId: 'ai-window-ai-1',
    closeTestId: 'close-ai-1',
    focusTestId: 'ai-window-ai-1',
    minimize: {
      testId: 'minimize-ai-1',
      dimensions: { x: 0, y: 0, width: 700, height: 600 }
    }
  },
  {
    label: 'help',
    type: 'help',
    id: 'help-1',
    windowTestId: 'help-window-help-1',
    closeTestId: 'close-help-1',
    focusTestId: 'help-window-help-1',
    minimize: {
      testId: 'minimize-help-1',
      dimensions: { x: 0, y: 0, width: 900, height: 700 }
    }
  },
  {
    label: 'classic',
    type: 'classic',
    id: 'classic-1',
    windowTestId: 'classic-window-classic-1',
    closeTestId: 'close-classic-1',
    focusTestId: 'classic-window-classic-1',
    minimize: {
      testId: 'minimize-classic-1',
      dimensions: { x: 0, y: 0, width: 980, height: 700 }
    }
  }
].sort((left, right) => left.label.localeCompare(right.label));
