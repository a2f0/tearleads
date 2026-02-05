import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { WindowRenderer } from './WindowRenderer';

interface WindowDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
}

vi.mock('@/components/notes-window', () => ({
  NotesWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    onDimensionsChange,
    initialDimensions,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    onDimensionsChange?: (dimensions: WindowDimensions) => void;
    initialDimensions?: WindowDimensions;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`notes-window-${id}`}
      data-initial-width={initialDimensions?.width}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 400, height: 300 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
      <button
        type="button"
        onClick={() =>
          onDimensionsChange?.({ x: 10, y: 20, width: 500, height: 400 })
        }
        data-testid={`resize-${id}`}
      >
        Resize
      </button>
    </div>
  )
}));

vi.mock('@/components/console-window', () => ({
  ConsoleWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    initialDimensions,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    initialDimensions?: WindowDimensions;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`console-window-${id}`}
      data-initial-width={initialDimensions?.width}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 400 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/email-window', () => ({
  EmailWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    initialDimensions,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    initialDimensions?: WindowDimensions;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`email-window-${id}`}
      data-initial-width={initialDimensions?.width}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 550, height: 450 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/settings-window', () => ({
  SettingsWindow: ({
    id,
    onClose,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`settings-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
    </div>
  )
}));

vi.mock('@/components/photos-window', () => ({
  PhotosWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`photos-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 550 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/models-window', () => ({
  ModelsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`models-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 720, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/keychain-window', () => ({
  KeychainWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`keychain-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/files-window', () => ({
  FilesWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`files-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 500, height: 400 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/documents-window', () => ({
  DocumentsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`documents-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 550 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/help-window', () => ({
  HelpWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`help-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 900, height: 700 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/video-window', () => ({
  VideoWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`video-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 750, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/contacts-window', () => ({
  ContactsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`contacts-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/local-storage-window', () => ({
  LocalStorageWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`local-storage-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 520, height: 420 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/sqlite-window', () => ({
  SqliteWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`sqlite-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/video-window', () => ({
  VideoWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`video-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 650, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/opfs-window', () => ({
  OpfsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`opfs-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 720, height: 560 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/cache-storage-window', () => ({
  CacheStorageWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`cache-storage-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 650, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/analytics-window', () => ({
  AnalyticsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`analytics-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 550 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/audio-window', () => ({
  AudioWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`audio-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/admin-window', () => ({
  AdminWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`admin-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  ),
  AdminRedisWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`admin-redis-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  ),
  AdminPostgresWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`admin-postgres-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  ),
  AdminGroupsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`admin-groups-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/admin-users-window', () => ({
  AdminUsersWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`admin-users-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 840, height: 620 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/admin-organizations-window', () => ({
  AdminOrganizationsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`admin-organizations-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 840, height: 620 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/chat-window', () => ({
  ChatWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`chat-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/tables-window', () => ({
  TablesWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`tables-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 850, height: 600 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/debug-window', () => ({
  DebugWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`debug-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 600, height: 500 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

vi.mock('@/components/documents-window', () => ({
  DocumentsWindow: ({
    id,
    onClose,
    onMinimize,
    onFocus,
    zIndex
  }: {
    id: string;
    onClose: () => void;
    onMinimize: (dimensions: WindowDimensions) => void;
    onFocus: () => void;
    zIndex: number;
  }) => (
    <div
      role="dialog"
      data-testid={`documents-window-${id}`}
      data-zindex={zIndex}
      onClick={onFocus}
      onKeyDown={(e) => e.key === 'Enter' && onFocus()}
    >
      <button type="button" onClick={onClose} data-testid={`close-${id}`}>
        Close
      </button>
      <button
        type="button"
        onClick={() => onMinimize({ x: 0, y: 0, width: 700, height: 550 })}
        data-testid={`minimize-${id}`}
      >
        Minimize
      </button>
    </div>
  )
}));

const mockOpenWindow = vi.fn();
const mockCloseWindow = vi.fn();
const mockFocusWindow = vi.fn();
const mockMinimizeWindow = vi.fn();
const mockSaveWindowDimensionsForType = vi.fn();
const mockUpdateWindowDimensions = vi.fn();

vi.mock('@/contexts/WindowManagerContext', async () => {
  const actual = await vi.importActual('@/contexts/WindowManagerContext');
  return {
    ...actual,
    useWindowManager: () => ({
      windows: mockWindows,
      openWindow: mockOpenWindow,
      requestWindowOpen: vi.fn(),
      windowOpenRequests: {},
      closeWindow: mockCloseWindow,
      focusWindow: mockFocusWindow,
      minimizeWindow: mockMinimizeWindow,
      restoreWindow: vi.fn(),
      saveWindowDimensionsForType: mockSaveWindowDimensionsForType,
      updateWindowDimensions: mockUpdateWindowDimensions,
      isWindowOpen: vi.fn(),
      getWindow: vi.fn()
    })
  };
});

let mockWindows: Array<{
  id: string;
  type: string;
  zIndex: number;
  dimensions?: WindowDimensions;
  isMinimized?: boolean;
}> = [];

function wrapper({ children }: { children: ReactNode }) {
  return <WindowManagerProvider>{children}</WindowManagerProvider>;
}

type WindowClickCase = [
  label: string,
  type: string,
  id: string,
  testId: string
];
type WindowMinimizeCase = [
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

function renderSingleWindow(type: string, id: string) {
  mockWindows = [{ id, type, zIndex: 100 }];
  render(<WindowRenderer />, { wrapper });
}

function hasFocusTestId(
  windowCase: WindowCase
): windowCase is WindowCase & { focusTestId: string } {
  return Boolean(windowCase.focusTestId);
}

function hasMinimizeCase(windowCase: WindowCase): windowCase is WindowCase & {
  minimize: { testId: string; dimensions: WindowDimensions };
} {
  return Boolean(windowCase.minimize);
}

describe('WindowRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWindows = [];
  });

  it('renders nothing when no windows are open', () => {
    mockWindows = [];
    const { container } = render(<WindowRenderer />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when all windows are minimized', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true }
    ];
    const { container } = render(<WindowRenderer />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it('skips minimized windows when rendering', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100, isMinimized: true },
      { id: 'notes-2', type: 'notes', zIndex: 101 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(
      screen.queryByTestId('notes-window-notes-1')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('notes-window-notes-2')).toBeInTheDocument();
  });

  it('renders multiple windows', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'notes-2', type: 'notes', zIndex: 101 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('notes-window-notes-2')).toBeInTheDocument();
  });

  it('calls saveWindowDimensionsForType when dimensions change', async () => {
    const user = userEvent.setup();
    mockWindows = [{ id: 'notes-1', type: 'notes', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });

    await user.click(screen.getByTestId('resize-notes-1'));
    expect(mockUpdateWindowDimensions).toHaveBeenCalledWith('notes-1', {
      x: 10,
      y: 20,
      width: 500,
      height: 400
    });
    expect(mockSaveWindowDimensionsForType).toHaveBeenCalledWith('notes', {
      x: 10,
      y: 20,
      width: 500,
      height: 400
    });
  });

  it('passes correct zIndex to windows', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'notes-2', type: 'notes', zIndex: 105 }
    ];
    render(<WindowRenderer />, { wrapper });

    expect(screen.getByTestId('notes-window-notes-1')).toHaveAttribute(
      'data-zindex',
      '100'
    );
    expect(screen.getByTestId('notes-window-notes-2')).toHaveAttribute(
      'data-zindex',
      '105'
    );
  });

  it('passes initial dimensions to notes window', () => {
    mockWindows = [
      {
        id: 'notes-1',
        type: 'notes',
        zIndex: 100,
        dimensions: { x: 12, y: 24, width: 420, height: 320 }
      }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toHaveAttribute(
      'data-initial-width',
      '420'
    );
  });

  it('passes initial dimensions to console window', () => {
    mockWindows = [
      {
        id: 'console-1',
        type: 'console',
        zIndex: 100,
        dimensions: { x: 20, y: 30, width: 640, height: 480 }
      }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('console-window-console-1')).toHaveAttribute(
      'data-initial-width',
      '640'
    );
  });

  it('passes initial dimensions to email window', () => {
    mockWindows = [
      {
        id: 'email-1',
        type: 'email',
        zIndex: 100,
        dimensions: { x: 24, y: 36, width: 520, height: 440 }
      }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('email-window-email-1')).toHaveAttribute(
      'data-initial-width',
      '520'
    );
  });

  it('renders nothing for unknown window types', () => {
    mockWindows = [{ id: 'unknown-1', type: 'unknown', zIndex: 100 }];
    render(<WindowRenderer />, { wrapper });
    // Should render fragment but no window content
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders mixed window types', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
  });

  it('renders all four window types together', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 },
      { id: 'settings-1', type: 'settings', zIndex: 102 },
      { id: 'email-1', type: 'email', zIndex: 103 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
  });

  const windowCases: WindowCase[] = [
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
      label: 'chat',
      type: 'chat',
      id: 'chat-1',
      windowTestId: 'chat-window-chat-1',
      closeTestId: 'close-chat-1',
      focusTestId: 'chat-window-chat-1',
      minimize: {
        testId: 'minimize-chat-1',
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
    }
  ];

  const renderCases: WindowClickCase[] = windowCases.map((windowCase) => [
    windowCase.label,
    windowCase.type,
    windowCase.id,
    windowCase.windowTestId
  ]);

  it.each(
    renderCases
  )('renders %s window for %s type', (_label, type, id, testId) => {
    renderSingleWindow(type, id);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  const closeCases: WindowClickCase[] = windowCases.map((windowCase) => [
    windowCase.label,
    windowCase.type,
    windowCase.id,
    windowCase.closeTestId
  ]);

  it.each(
    closeCases
  )('calls closeWindow when %s close button is clicked', async (_label, type, id, testId) => {
    const user = userEvent.setup();
    renderSingleWindow(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockCloseWindow).toHaveBeenCalledWith(id);
  });

  const focusCases: WindowClickCase[] = windowCases
    .filter(hasFocusTestId)
    .map((windowCase) => [
      windowCase.label,
      windowCase.type,
      windowCase.id,
      windowCase.focusTestId
    ]);

  it.each(
    focusCases
  )('calls focusWindow when %s window is clicked', async (_label, type, id, testId) => {
    const user = userEvent.setup();
    renderSingleWindow(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockFocusWindow).toHaveBeenCalledWith(id);
  });

  const minimizeCases: WindowMinimizeCase[] = windowCases
    .filter(hasMinimizeCase)
    .map((windowCase) => [
      windowCase.label,
      windowCase.type,
      windowCase.id,
      windowCase.minimize.testId,
      windowCase.minimize.dimensions
    ]);

  it.each(
    minimizeCases
  )('calls minimizeWindow when %s minimize button is clicked', async (_label, type, id, testId, dimensions) => {
    const user = userEvent.setup();
    renderSingleWindow(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockMinimizeWindow).toHaveBeenCalledWith(id, dimensions);
  });

  it('renders all twenty-one window types together', () => {
    mockWindows = [
      { id: 'notes-1', type: 'notes', zIndex: 100 },
      { id: 'console-1', type: 'console', zIndex: 101 },
      { id: 'settings-1', type: 'settings', zIndex: 102 },
      { id: 'email-1', type: 'email', zIndex: 103 },
      { id: 'files-1', type: 'files', zIndex: 104 },
      { id: 'videos-1', type: 'videos', zIndex: 105 },
      { id: 'photos-1', type: 'photos', zIndex: 106 },
      { id: 'models-1', type: 'models', zIndex: 107 },
      { id: 'keychain-1', type: 'keychain', zIndex: 108 },
      { id: 'contacts-1', type: 'contacts', zIndex: 109 },
      { id: 'sqlite-1', type: 'sqlite', zIndex: 110 },
      { id: 'chat-1', type: 'chat', zIndex: 111 },
      { id: 'analytics-1', type: 'analytics', zIndex: 112 },
      { id: 'audio-1', type: 'audio', zIndex: 113 },
      { id: 'admin-1', type: 'admin', zIndex: 114 },
      { id: 'tables-1', type: 'tables', zIndex: 115 },
      { id: 'debug-1', type: 'debug', zIndex: 116 },
      { id: 'documents-1', type: 'documents', zIndex: 117 },
      { id: 'help-1', type: 'help', zIndex: 118 },
      { id: 'local-storage-1', type: 'local-storage', zIndex: 119 },
      { id: 'opfs-1', type: 'opfs', zIndex: 120 }
    ];
    render(<WindowRenderer />, { wrapper });
    expect(screen.getByTestId('notes-window-notes-1')).toBeInTheDocument();
    expect(screen.getByTestId('console-window-console-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-window-settings-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-window-email-1')).toBeInTheDocument();
    expect(screen.getByTestId('files-window-files-1')).toBeInTheDocument();
    expect(screen.getByTestId('video-window-videos-1')).toBeInTheDocument();
    expect(screen.getByTestId('photos-window-photos-1')).toBeInTheDocument();
    expect(screen.getByTestId('models-window-models-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('keychain-window-keychain-1')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('contacts-window-contacts-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('sqlite-window-sqlite-1')).toBeInTheDocument();
    expect(screen.getByTestId('opfs-window-opfs-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('local-storage-window-local-storage-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('chat-window-chat-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('analytics-window-analytics-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('audio-window-audio-1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-window-admin-1')).toBeInTheDocument();
    expect(screen.getByTestId('tables-window-tables-1')).toBeInTheDocument();
    expect(screen.getByTestId('debug-window-debug-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('documents-window-documents-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('help-window-help-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('local-storage-window-local-storage-1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('opfs-window-opfs-1')).toBeInTheDocument();
  });
});
