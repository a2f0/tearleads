import {
  Binary,
  Building,
  FileIcon,
  Folder,
  HeartPulse,
  ImageIcon,
  Images,
  ListMusic,
  Mail,
  MessageSquare,
  Music,
  Smartphone,
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
  mlsMessage: MessageSquare,
  conversation: MessageSquare,
  healthReading: HeartPulse,
  organization: Building,
  user: User,
  group: Users,
  device: Smartphone,
  // Collections
  folder: Folder,
  emailFolder: Mail,
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
  mlsMessage: 'text-indigo-600 dark:text-indigo-400',
  conversation: 'text-indigo-600 dark:text-indigo-400',
  healthReading: 'text-rose-600 dark:text-rose-400',
  organization: 'text-indigo-700 dark:text-indigo-300',
  user: 'text-cyan-600 dark:text-cyan-400',
  group: 'text-emerald-600 dark:text-emerald-400',
  device: 'text-gray-700 dark:text-gray-300',
  // Collections
  folder: 'text-yellow-600 dark:text-yellow-500',
  emailFolder: 'text-sky-600 dark:text-sky-400',
  playlist: 'text-purple-600 dark:text-purple-400',
  album: 'text-success',
  contactGroup: 'text-blue-600 dark:text-blue-400',
  tag: 'text-pink-600 dark:text-pink-400'
};
