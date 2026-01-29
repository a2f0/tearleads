import { FileIcon, Folder, ImageIcon, StickyNote, User } from 'lucide-react';
import type { VfsObjectType } from '../hooks';

export const OBJECT_TYPE_ICONS: Record<VfsObjectType, typeof Folder> = {
  folder: Folder,
  contact: User,
  note: StickyNote,
  file: FileIcon,
  photo: ImageIcon
};

export const OBJECT_TYPE_COLORS: Record<VfsObjectType, string> = {
  folder: 'text-yellow-600 dark:text-yellow-500',
  contact: 'text-blue-600 dark:text-blue-400',
  note: 'text-amber-600 dark:text-amber-400',
  file: 'text-gray-600 dark:text-gray-400',
  photo: 'text-green-600 dark:text-green-400'
};
