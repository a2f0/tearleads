import type { I18NextTranslations } from './types';

export const en = {
  common: {
    language: 'Language',
    languageName: 'English',
    selectLanguage: 'Select language',
    settings: 'Settings',
    theme: 'Theme',
    themeDescription: 'Choose your preferred color theme'
  },
  menu: {
    home: 'Home',
    files: 'Files',
    contacts: 'Contacts',
    photos: 'Photos',
    documents: 'Documents',
    notes: 'Notes',
    audio: 'Audio',
    videos: 'Videos',
    tables: 'Tables',
    analytics: 'Analytics',
    sqlite: 'SQLite',
    console: 'Console',
    debug: 'Debug',
    opfs: 'OPFS',
    cacheStorage: 'Cache Storage',
    localStorage: 'Local Storage',
    keychain: 'Keychain',
    chat: 'Chat',
    models: 'Models',
    admin: 'Admin',
    settings: 'Settings'
  },
  audio: {
    play: 'Play',
    pause: 'Pause',
    previousTrack: 'Previous track',
    nextTrack: 'Next track',
    restart: 'Restart track',
    rewind: 'Rewind',
    close: 'Close player',
    repeatOff: 'Repeat: Off',
    repeatAll: 'Repeat: All tracks',
    repeatOne: 'Repeat: Current track'
  },
  tooltips: {
    sseConnected: 'SSE: Connected',
    sseConnecting: 'SSE: Connecting',
    sseDisconnected: 'SSE: Disconnected',
    keychainSalt:
      'Random value used with your password to derive the encryption key',
    keychainKeyCheckValue:
      'Hash used to verify your password is correct without storing it',
    keychainSessionWrappingKey:
      'Temporary key that encrypts your session data in memory',
    keychainSessionWrappedKey:
      'Your encryption key protected by the session wrapping key'
  },
  contextMenu: {
    play: 'Play',
    pause: 'Pause',
    getInfo: 'Get info',
    viewDetails: 'View Details',
    download: 'Download',
    edit: 'Edit',
    delete: 'Delete',
    exportVCard: 'Export vCard'
  },
  settings: {
    font: 'Font',
    fontDescription: 'Choose your preferred font style',
    fontSystem: 'System',
    fontMonospace: 'Monospace',
    tooltips: 'Tooltips',
    tooltipsDescription: 'Show helpful hints when hovering over elements',
    tooltipsEnabled: 'Enabled',
    tooltipsDisabled: 'Disabled'
  }
} as const satisfies I18NextTranslations;
