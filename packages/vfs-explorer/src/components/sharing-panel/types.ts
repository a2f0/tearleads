import type {
  VfsPermissionLevel,
  VfsShareType
} from '@tearleads/shared';
import type { LucideIcon } from 'lucide-react';
import { Building2, Download, Eye, Pencil, User, Users } from 'lucide-react';

export interface SharingPanelProps {
  item: { id: string; objectType: string; name: string; createdAt: Date };
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

export interface ShareEditState {
  shareId: string;
  permissionLevel: VfsPermissionLevel;
  expiresAt: string;
}

export interface DeleteConfirmState {
  shareId: string;
  targetName: string;
  isOrg: boolean;
}

export const SHARE_TYPE_ICONS: Record<VfsShareType, LucideIcon> = {
  user: User,
  group: Users,
  organization: Building2
};

export const SHARE_TYPE_LABELS: Record<VfsShareType, string> = {
  user: 'User',
  group: 'Group',
  organization: 'Org'
};

interface PermissionOption {
  value: VfsPermissionLevel;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const PERMISSION_OPTIONS: PermissionOption[] = [
  {
    value: 'view',
    label: 'View',
    description: 'Can view this item and its contents',
    icon: Eye
  },
  {
    value: 'edit',
    label: 'Edit',
    description: 'Can view, edit, and organize this item',
    icon: Pencil
  },
  {
    value: 'download',
    label: 'Download',
    description: 'Can view and download a copy of this item',
    icon: Download
  }
];

export const PERMISSION_LABELS: Record<VfsPermissionLevel, string> = {
  view: 'View',
  edit: 'Edit',
  download: 'Download'
};

export const PERMISSION_COLORS: Record<VfsPermissionLevel, string> = {
  view: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  edit: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  download:
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
};

export const FRIENDLY_STATE_LABELS: Record<string, string> = {
  direct: 'Has access',
  derived: 'Inherited',
  denied: 'Blocked',
  included: 'Has access',
  excluded: 'No access'
};

export const FRIENDLY_STATE_COLORS: Record<string, string> = {
  direct:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  derived:
    'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  denied: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  included:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  excluded: 'bg-muted text-muted-foreground'
};

