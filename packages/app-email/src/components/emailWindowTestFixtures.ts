import { vi } from 'vitest';
import type { EmailFolderOperations } from '../context';

const mockEmails = [
  {
    id: 'email-1',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'Test Subject',
    receivedAt: '2024-01-15T10:00:00Z',
    size: 1024
  }
];

const mockEmailLargeSize = {
  id: 'email-2',
  from: 'large@example.com',
  to: ['recipient@example.com'],
  subject: 'Large Email',
  receivedAt: '2024-01-15T11:00:00Z',
  size: 2 * 1024 * 1024
};

const mockEmailSmallSize = {
  id: 'email-3',
  from: 'small@example.com',
  to: ['recipient@example.com'],
  subject: 'Small Email',
  receivedAt: '2024-01-15T12:00:00Z',
  size: 500
};

const mockFolderOperations: EmailFolderOperations = {
  fetchFolders: vi.fn().mockResolvedValue([
    {
      id: 'folder-inbox',
      name: 'Inbox',
      folderType: 'inbox',
      parentId: null,
      unreadCount: 0
    },
    {
      id: 'folder-sent',
      name: 'Sent',
      folderType: 'sent',
      parentId: null,
      unreadCount: 0
    },
    {
      id: 'folder-drafts',
      name: 'Drafts',
      folderType: 'drafts',
      parentId: null,
      unreadCount: 0
    },
    {
      id: 'folder-trash',
      name: 'Trash',
      folderType: 'trash',
      parentId: null,
      unreadCount: 0
    }
  ]),
  createFolder: vi.fn().mockResolvedValue({
    id: 'new-folder',
    name: 'New Folder',
    folderType: 'custom',
    parentId: null,
    unreadCount: 0
  }),
  renameFolder: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  moveFolder: vi.fn().mockResolvedValue(undefined),
  initializeSystemFolders: vi.fn().mockResolvedValue(undefined),
  getFolderByType: vi.fn().mockResolvedValue(null)
};

export {
  mockEmails,
  mockEmailLargeSize,
  mockEmailSmallSize,
  mockFolderOperations
};
