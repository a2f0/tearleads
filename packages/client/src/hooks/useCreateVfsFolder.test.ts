import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateVfsFolder } from './useCreateVfsFolder';

// Mock database
const mockInsert = vi.fn(() => ({
  values: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({
    insert: mockInsert
  }))
}));

// Mock schema
vi.mock('@/db/schema', () => ({
  vfsFolders: { id: 'id', encryptedName: 'encrypted_name' },
  vfsLinks: { id: 'id', parentId: 'parent_id', childId: 'child_id' },
  vfsRegistry: { id: 'id', objectType: 'object_type', ownerId: 'owner_id' }
}));

// Mock auth
vi.mock('@/lib/auth-storage', () => ({
  isLoggedIn: vi.fn(),
  readStoredAuth: vi.fn(() => ({
    user: { id: 'test-user-id', email: 'test@example.com' }
  }))
}));

// Mock VFS keys
vi.mock('./useVfsKeys', () => ({
  generateSessionKey: vi.fn(() => new Uint8Array(32)),
  wrapSessionKey: vi.fn(async () => 'wrapped-session-key')
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    vfs: {
      register: vi.fn().mockResolvedValue({
        id: 'test-id',
        createdAt: new Date().toISOString()
      })
    }
  }
}));

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-1234')
});

import { act, renderHook } from '@testing-library/react';
import { api } from '@/lib/api';
import { isLoggedIn, readStoredAuth } from '@/lib/auth-storage';

describe('useCreateVfsFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLoggedIn).mockReturnValue(false);
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useCreateVfsFolder());

    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.createFolder).toBe('function');
  });

  it('creates folder successfully', async () => {
    const { result } = renderHook(() => useCreateVfsFolder());

    let folderResult: { id: string; name: string } | undefined;

    await act(async () => {
      folderResult = await result.current.createFolder('Test Folder');
    });

    expect(folderResult).toEqual({
      id: 'test-uuid-1234',
      name: 'Test Folder'
    });
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('throws error for empty name', async () => {
    const { result } = renderHook(() => useCreateVfsFolder());

    await expect(
      act(async () => {
        await result.current.createFolder('');
      })
    ).rejects.toThrow('Folder name is required');
  });

  it('throws error for whitespace-only name', async () => {
    const { result } = renderHook(() => useCreateVfsFolder());

    await expect(
      act(async () => {
        await result.current.createFolder('   ');
      })
    ).rejects.toThrow('Folder name is required');
  });

  it('trims folder name', async () => {
    const { result } = renderHook(() => useCreateVfsFolder());

    let folderResult: { id: string; name: string } | undefined;

    await act(async () => {
      folderResult = await result.current.createFolder('  Trimmed Name  ');
    });

    expect(folderResult?.name).toBe('Trimmed Name');
  });

  it('creates folder with parent link when parentId is provided', async () => {
    const { result } = renderHook(() => useCreateVfsFolder());

    await act(async () => {
      await result.current.createFolder('Child Folder', 'parent-folder-id');
    });

    // Should have 3 inserts: registry, folders, links
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });

  it('registers on server when logged in', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);

    const { result } = renderHook(() => useCreateVfsFolder());

    await act(async () => {
      await result.current.createFolder('Server Folder');
    });

    expect(api.vfs.register).toHaveBeenCalledWith({
      id: 'test-uuid-1234',
      objectType: 'folder',
      encryptedSessionKey: 'wrapped-session-key'
    });
  });

  it('continues if server registration fails', async () => {
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(api.vfs.register).mockRejectedValueOnce(
      new Error('Server error')
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useCreateVfsFolder());

    let folderResult: { id: string; name: string } | undefined;

    await act(async () => {
      folderResult = await result.current.createFolder('Offline Folder');
    });

    expect(folderResult?.name).toBe('Offline Folder');
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to register folder on server:',
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });

  it('sets error state on failure', async () => {
    mockInsert.mockImplementationOnce(() => {
      throw new Error('Database error');
    });

    const { result } = renderHook(() => useCreateVfsFolder());

    let caughtError: Error | undefined;

    await act(async () => {
      try {
        await result.current.createFolder('Failed Folder');
      } catch (err) {
        caughtError = err as Error;
      }
    });

    expect(caughtError?.message).toBe('Database error');
    expect(result.current.error).toBe('Database error');
    expect(result.current.isCreating).toBe(false);
  });

  it('uses unknown for ownerId when user is not available', async () => {
    vi.mocked(readStoredAuth).mockReturnValueOnce({
      token: null,
      refreshToken: null,
      user: null
    });

    const { result } = renderHook(() => useCreateVfsFolder());

    await act(async () => {
      await result.current.createFolder('Anonymous Folder');
    });

    expect(result.current.error).toBeNull();
  });
});
