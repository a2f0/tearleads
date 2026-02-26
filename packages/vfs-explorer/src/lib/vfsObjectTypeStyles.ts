import {
  Binary,
  FileIcon,
  Folder,
  ImageIcon,
  Images,
  ListMusic,
  Mail,
  MessageSquare,
  Music,
  StickyNote,
  Tag,
  User,
  Users,
  Video
} from 'lucide-react';
import type { VfsObjectType } from './vfsTypes';

export const OBJECT_TYPE_ICONS: Record<VfsObjectType, typeof Folder> = {
  // Entities
  file: FileIcon,
  blob: Binary,
  photo: ImageIcon,
  audio: Music,
  video: Video,
  contact: User,
  note: StickyNote,
  email: Mail,
  conversation: MessageSquare,
  // Collections
  folder: Folder,
  playlist: ListMusic,
  album: Images,
  contactGroup: Users,
  tag: Tag
};

export const OBJECT_TYPE_COLORS: Record<VfsObjectType, string> = {
  // Entities
  file: 'text-gray-600 dark:text-gray-400',
  blob: 'text-slate-600 dark:text-slate-400',
  photo: 'text-green-600 dark:text-green-400',
  audio: 'text-purple-600 dark:text-purple-400',
  video: 'text-red-600 dark:text-red-400',
  contact: 'text-blue-600 dark:text-blue-400',
  note: 'text-amber-600 dark:text-amber-400',
  email: 'text-sky-600 dark:text-sky-400',
  conversation: 'text-indigo-600 dark:text-indigo-400',
  // Collections
  folder: 'text-yellow-600 dark:text-yellow-500',
  playlist: 'text-purple-600 dark:text-purple-400',
  album: 'text-success',
  contactGroup: 'text-blue-600 dark:text-blue-400',
  tag: 'text-pink-600 dark:text-pink-400'
};
