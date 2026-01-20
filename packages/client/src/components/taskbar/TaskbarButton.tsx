import {
  Archive,
  BarChart2,
  Bot,
  Bug,
  Copy,
  Database,
  FileIcon,
  FileText,
  Film,
  HardDrive,
  ImageIcon,
  KeyRound,
  Mail,
  MessageSquare,
  Minus,
  Music,
  Settings,
  Shield,
  Square,
  StickyNote,
  Table2,
  Terminal,
  User,
  X
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { cn } from '@/lib/utils';

const WINDOW_ICONS: Record<WindowType, React.ReactNode> = {
  notes: <StickyNote className="h-3 w-3" />,
  console: <Terminal className="h-3 w-3" />,
  settings: <Settings className="h-3 w-3" />,
  files: <FileIcon className="h-3 w-3" />,
  tables: <Table2 className="h-3 w-3" />,
  debug: <Bug className="h-3 w-3" />,
  documents: <FileText className="h-3 w-3" />,
  email: <Mail className="h-3 w-3" />,
  contacts: <User className="h-3 w-3" />,
  photos: <ImageIcon className="h-3 w-3" />,
  videos: <Film className="h-3 w-3" />,
  keychain: <KeyRound className="h-3 w-3" />,
  sqlite: <Database className="h-3 w-3" />,
  opfs: <HardDrive className="h-3 w-3" />,
  chat: <MessageSquare className="h-3 w-3" />,
  analytics: <BarChart2 className="h-3 w-3" />,
  audio: <Music className="h-3 w-3" />,
  models: <Bot className="h-3 w-3" />,
  admin: <Shield className="h-3 w-3" />,
  'admin-postgres': <Database className="h-3 w-3" />,
  'cache-storage': <Archive className="h-3 w-3" />,
  'local-storage': <HardDrive className="h-3 w-3" />
};

const WINDOW_LABELS: Record<WindowType, string> = {
  notes: 'Notes',
  console: 'Console',
  settings: 'Settings',
  files: 'Files',
  tables: 'Tables',
  debug: 'Debug',
  documents: 'Documents',
  email: 'Email',
  contacts: 'Contacts',
  photos: 'Photos',
  videos: 'Videos',
  keychain: 'Keychain',
  sqlite: 'SQLite',
  opfs: 'OPFS',
  chat: 'Chat',
  analytics: 'Analytics',
  audio: 'Audio',
  models: 'Models',
  admin: 'Admin',
  'admin-postgres': 'Postgres Admin',
  'cache-storage': 'Cache Storage',
  'local-storage': 'Local Storage'
};

interface TaskbarButtonProps {
  type: WindowType;
  isActive: boolean;
  isMinimized?: boolean;
  onClick: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onMaximize: () => void;
}

export function TaskbarButton({
  type,
  isActive,
  isMinimized = false,
  onClick,
  onMinimize,
  onClose,
  onMaximize
}: TaskbarButtonProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRestore = useCallback(() => {
    onClick();
    setContextMenu(null);
  }, [onClick]);

  const handleMinimize = useCallback(() => {
    onMinimize();
    setContextMenu(null);
  }, [onMinimize]);

  const handleClose = useCallback(() => {
    onClose();
    setContextMenu(null);
  }, [onClose]);

  const handleMaximize = useCallback(() => {
    onMaximize();
    setContextMenu(null);
  }, [onMaximize]);

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={handleContextMenu}
        className={cn(
          'flex items-center gap-1.5 border px-2 py-1 text-xs transition-colors',
          isActive
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
          isMinimized && 'opacity-60'
        )}
        data-testid={`taskbar-button-${type}`}
        data-minimized={isMinimized}
      >
        {WINDOW_ICONS[type]}
        <span>{WINDOW_LABELS[type]}</span>
      </button>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          {isMinimized ? (
            <>
              <ContextMenuItem
                icon={<Copy className="h-4 w-4" />}
                onClick={handleRestore}
              >
                Restore
              </ContextMenuItem>
              <ContextMenuItem
                icon={<Square className="h-4 w-4" />}
                onClick={handleMaximize}
              >
                Maximize
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem
              icon={<Minus className="h-4 w-4" />}
              onClick={handleMinimize}
            >
              Minimize
            </ContextMenuItem>
          )}
          <ContextMenuItem
            icon={<X className="h-4 w-4" />}
            onClick={handleClose}
          >
            Close
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
