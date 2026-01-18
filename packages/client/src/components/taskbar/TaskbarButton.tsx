import {
  Archive,
  BarChart2,
  Bug,
  Database,
  FileIcon,
  FileText,
  Film,
  HardDrive,
  ImageIcon,
  KeyRound,
  Mail,
  MessageSquare,
  Music,
  Settings,
  Shield,
  StickyNote,
  Table2,
  Terminal,
  User
} from 'lucide-react';
import type { WindowType } from '@/contexts/WindowManagerContext';
import { cn } from '@/lib/utils';

const WINDOW_ICONS: Record<WindowType, React.ReactNode> = {
  notes: <StickyNote className="h-3 w-3" />,
  console: <Terminal className="h-3 w-3" />,
  settings: <Settings className="h-3 w-3" />,
  files: <FileIcon className="h-3 w-3" />,
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
  admin: <Shield className="h-3 w-3" />,
  'cache-storage': <Archive className="h-3 w-3" />
};

const WINDOW_LABELS: Record<WindowType, string> = {
  notes: 'Notes',
  console: 'Console',
  settings: 'Settings',
  files: 'Files',
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
  admin: 'Admin',
  'cache-storage': 'Cache Storage'
};

interface TaskbarButtonProps {
  type: WindowType;
  isActive: boolean;
  isMinimized?: boolean;
  onClick: () => void;
}

export function TaskbarButton({
  type,
  isActive,
  isMinimized = false,
  onClick
}: TaskbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors',
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
  );
}
