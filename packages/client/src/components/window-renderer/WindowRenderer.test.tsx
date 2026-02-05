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

function renderSingleWindow(type: string, id: string) {
  mockWindows = [{ id, type, zIndex: 100 }];
  render(<WindowRenderer />, { wrapper });
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

  const renderCases: WindowClickCase[] = [
    ['notes', 'notes', 'notes-1', 'notes-window-notes-1'],
    ['console', 'console', 'console-1', 'console-window-console-1'],
    ['settings', 'settings', 'settings-1', 'settings-window-settings-1'],
    ['email', 'email', 'email-1', 'email-window-email-1'],
    ['files', 'files', 'files-1', 'files-window-files-1'],
    ['tables', 'tables', 'tables-1', 'tables-window-tables-1'],
    ['debug', 'debug', 'debug-1', 'debug-window-debug-1'],
    ['documents', 'documents', 'documents-1', 'documents-window-documents-1'],
    ['photos', 'photos', 'photos-1', 'photos-window-photos-1'],
    ['models', 'models', 'models-1', 'models-window-models-1'],
    ['keychain', 'keychain', 'keychain-1', 'keychain-window-keychain-1'],
    ['contacts', 'contacts', 'contacts-1', 'contacts-window-contacts-1'],
    ['sqlite', 'sqlite', 'sqlite-1', 'sqlite-window-sqlite-1'],
    ['opfs', 'opfs', 'opfs-1', 'opfs-window-opfs-1'],
    [
      'local storage',
      'local-storage',
      'local-storage-1',
      'local-storage-window-local-storage-1'
    ],
    ['analytics', 'analytics', 'analytics-1', 'analytics-window-analytics-1'],
    ['audio', 'audio', 'audio-1', 'audio-window-audio-1'],
    ['admin', 'admin', 'admin-1', 'admin-window-admin-1'],
    [
      'admin users',
      'admin-users',
      'admin-users-1',
      'admin-users-window-admin-users-1'
    ],
    [
      'admin organizations',
      'admin-organizations',
      'admin-organizations-1',
      'admin-organizations-window-admin-organizations-1'
    ],
    ['chat', 'chat', 'chat-1', 'chat-window-chat-1'],
    ['help', 'help', 'help-1', 'help-window-help-1']
  ];

  it.each(
    renderCases
  )('renders %s window for %s type', (_label, type, id, testId) => {
    renderSingleWindow(type, id);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  const closeCases: WindowClickCase[] = [
    ['notes', 'notes', 'notes-1', 'close-notes-1'],
    ['console', 'console', 'console-1', 'close-console-1'],
    ['settings', 'settings', 'settings-1', 'close-settings-1'],
    ['email', 'email', 'email-1', 'close-email-1'],
    ['contacts', 'contacts', 'contacts-1', 'close-contacts-1'],
    ['sqlite', 'sqlite', 'sqlite-1', 'close-sqlite-1'],
    ['opfs', 'opfs', 'opfs-1', 'close-opfs-1'],
    ['files', 'files', 'files-1', 'close-files-1'],
    ['documents', 'documents', 'documents-1', 'close-documents-1'],
    ['photos', 'photos', 'photos-1', 'close-photos-1'],
    ['models', 'models', 'models-1', 'close-models-1'],
    ['keychain', 'keychain', 'keychain-1', 'close-keychain-1'],
    [
      'local storage',
      'local-storage',
      'local-storage-1',
      'close-local-storage-1'
    ],
    ['analytics', 'analytics', 'analytics-1', 'close-analytics-1'],
    ['audio', 'audio', 'audio-1', 'close-audio-1'],
    ['admin', 'admin', 'admin-1', 'close-admin-1'],
    ['admin users', 'admin-users', 'admin-users-1', 'close-admin-users-1'],
    [
      'admin organizations',
      'admin-organizations',
      'admin-organizations-1',
      'close-admin-organizations-1'
    ],
    ['chat', 'chat', 'chat-1', 'close-chat-1'],
    ['tables', 'tables', 'tables-1', 'close-tables-1'],
    ['debug', 'debug', 'debug-1', 'close-debug-1'],
    ['help', 'help', 'help-1', 'close-help-1']
  ];

  it.each(
    closeCases
  )('calls closeWindow when %s close button is clicked', async (_label, type, id, testId) => {
    const user = userEvent.setup();
    renderSingleWindow(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockCloseWindow).toHaveBeenCalledWith(id);
  });

  const focusCases: WindowClickCase[] = [
    ['notes', 'notes', 'notes-1', 'notes-window-notes-1'],
    ['email', 'email', 'email-1', 'email-window-email-1'],
    ['contacts', 'contacts', 'contacts-1', 'contacts-window-contacts-1'],
    ['sqlite', 'sqlite', 'sqlite-1', 'sqlite-window-sqlite-1'],
    ['files', 'files', 'files-1', 'files-window-files-1'],
    ['documents', 'documents', 'documents-1', 'documents-window-documents-1'],
    ['photos', 'photos', 'photos-1', 'photos-window-photos-1'],
    ['models', 'models', 'models-1', 'models-window-models-1'],
    ['keychain', 'keychain', 'keychain-1', 'keychain-window-keychain-1'],
    [
      'local storage',
      'local-storage',
      'local-storage-1',
      'local-storage-window-local-storage-1'
    ],
    ['analytics', 'analytics', 'analytics-1', 'analytics-window-analytics-1'],
    ['audio', 'audio', 'audio-1', 'audio-window-audio-1'],
    ['admin', 'admin', 'admin-1', 'admin-window-admin-1'],
    [
      'admin users',
      'admin-users',
      'admin-users-1',
      'admin-users-window-admin-users-1'
    ],
    [
      'admin organizations',
      'admin-organizations',
      'admin-organizations-1',
      'admin-organizations-window-admin-organizations-1'
    ],
    ['chat', 'chat', 'chat-1', 'chat-window-chat-1'],
    ['tables', 'tables', 'tables-1', 'tables-window-tables-1'],
    ['debug', 'debug', 'debug-1', 'debug-window-debug-1'],
    ['help', 'help', 'help-1', 'help-window-help-1']
  ];

  it.each(
    focusCases
  )('calls focusWindow when %s window is clicked', async (_label, type, id, testId) => {
    const user = userEvent.setup();
    renderSingleWindow(type, id);
    await user.click(screen.getByTestId(testId));
    expect(mockFocusWindow).toHaveBeenCalledWith(id);
  });

  const minimizeCases: WindowMinimizeCase[] = [
    [
      'notes',
      'notes',
      'notes-1',
      'minimize-notes-1',
      { x: 0, y: 0, width: 400, height: 300 }
    ],
    [
      'console',
      'console',
      'console-1',
      'minimize-console-1',
      { x: 0, y: 0, width: 600, height: 400 }
    ],
    [
      'email',
      'email',
      'email-1',
      'minimize-email-1',
      { x: 0, y: 0, width: 550, height: 450 }
    ],
    [
      'contacts',
      'contacts',
      'contacts-1',
      'minimize-contacts-1',
      { x: 0, y: 0, width: 600, height: 500 }
    ],
    [
      'sqlite',
      'sqlite',
      'sqlite-1',
      'minimize-sqlite-1',
      { x: 0, y: 0, width: 600, height: 500 }
    ],
    [
      'opfs',
      'opfs',
      'opfs-1',
      'minimize-opfs-1',
      { x: 0, y: 0, width: 720, height: 560 }
    ],
    [
      'files',
      'files',
      'files-1',
      'minimize-files-1',
      { x: 0, y: 0, width: 500, height: 400 }
    ],
    [
      'documents',
      'documents',
      'documents-1',
      'minimize-documents-1',
      { x: 0, y: 0, width: 700, height: 550 }
    ],
    [
      'photos',
      'photos',
      'photos-1',
      'minimize-photos-1',
      { x: 0, y: 0, width: 700, height: 550 }
    ],
    [
      'models',
      'models',
      'models-1',
      'minimize-models-1',
      { x: 0, y: 0, width: 720, height: 600 }
    ],
    [
      'keychain',
      'keychain',
      'keychain-1',
      'minimize-keychain-1',
      { x: 0, y: 0, width: 600, height: 500 }
    ],
    [
      'local storage',
      'local-storage',
      'local-storage-1',
      'minimize-local-storage-1',
      { x: 0, y: 0, width: 520, height: 420 }
    ],
    [
      'analytics',
      'analytics',
      'analytics-1',
      'minimize-analytics-1',
      { x: 0, y: 0, width: 700, height: 550 }
    ],
    [
      'audio',
      'audio',
      'audio-1',
      'minimize-audio-1',
      { x: 0, y: 0, width: 600, height: 500 }
    ],
    [
      'admin',
      'admin',
      'admin-1',
      'minimize-admin-1',
      { x: 0, y: 0, width: 700, height: 600 }
    ],
    [
      'admin users',
      'admin-users',
      'admin-users-1',
      'minimize-admin-users-1',
      { x: 0, y: 0, width: 840, height: 620 }
    ],
    [
      'admin organizations',
      'admin-organizations',
      'admin-organizations-1',
      'minimize-admin-organizations-1',
      { x: 0, y: 0, width: 840, height: 620 }
    ],
    [
      'chat',
      'chat',
      'chat-1',
      'minimize-chat-1',
      { x: 0, y: 0, width: 700, height: 600 }
    ],
    [
      'tables',
      'tables',
      'tables-1',
      'minimize-tables-1',
      { x: 0, y: 0, width: 850, height: 600 }
    ],
    [
      'debug',
      'debug',
      'debug-1',
      'minimize-debug-1',
      { x: 0, y: 0, width: 600, height: 500 }
    ],
    [
      'help',
      'help',
      'help-1',
      'minimize-help-1',
      { x: 0, y: 0, width: 900, height: 700 }
    ]
  ];

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
