import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFileOpenTarget, resolvePlaylistType } from './vfsOpen';

const mockGetDatabase = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: () => mockGetDatabase()
}));

vi.mock('@/db/schema', () => ({
  files: {
    id: 'id',
    mimeType: 'mimeType'
  },
  playlists: {
    id: 'id',
    mediaType: 'mediaType'
  }
}));

function mockDbSelect(result?: Record<string, unknown>) {
  mockGetDatabase.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(result ? [result] : [])
        })
      })
    })
  });
}

function mockDbQueryReject(error: Error) {
  mockGetDatabase.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.reject(error)
        })
      })
    })
  });
}

describe('resolveFileOpenTarget', () => {
  beforeEach(() => {
    mockGetDatabase.mockReset();
  });

  it('returns document for pdf files', async () => {
    mockDbSelect({ mimeType: 'application/pdf' });
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('document');
  });

  it('returns photo for image files', async () => {
    mockDbSelect({ mimeType: 'image/png' });
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('photo');
  });

  it('returns audio for audio files', async () => {
    mockDbSelect({ mimeType: 'audio/mpeg' });
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('audio');
  });

  it('returns video for video files', async () => {
    mockDbSelect({ mimeType: 'video/mp4' });
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('video');
  });

  it('returns file for unknown types', async () => {
    mockDbSelect({ mimeType: 'application/octet-stream' });
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('file');
  });

  it('returns file when no rows are found', async () => {
    mockDbSelect();
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('file');
  });

  it('returns file when database lookup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetDatabase.mockImplementation(() => {
      throw new Error('db error');
    });

    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('file');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns file when database query fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDbQueryReject(new Error('db query error'));

    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('file');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('resolvePlaylistType', () => {
  beforeEach(() => {
    mockGetDatabase.mockReset();
  });

  it('returns video for video playlists', async () => {
    mockDbSelect({ mediaType: 'video' });
    await expect(resolvePlaylistType('playlist-1')).resolves.toBe('video');
  });

  it('returns audio for audio playlists', async () => {
    mockDbSelect({ mediaType: 'audio' });
    await expect(resolvePlaylistType('playlist-1')).resolves.toBe('audio');
  });

  it('returns audio when playlist is not found', async () => {
    mockDbSelect();
    await expect(resolvePlaylistType('playlist-1')).resolves.toBe('audio');
  });

  it('returns audio when database lookup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetDatabase.mockImplementation(() => {
      throw new Error('db error');
    });

    await expect(resolvePlaylistType('playlist-1')).resolves.toBe('audio');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns audio when database query fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDbQueryReject(new Error('db query error'));

    await expect(resolvePlaylistType('playlist-1')).resolves.toBe('audio');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
