import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFileOpenTarget } from './vfs-open';

const mockGetDatabase = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: () => mockGetDatabase()
}));

vi.mock('@/db/schema', () => ({
  files: {
    id: 'id',
    mimeType: 'mimeType'
  }
}));

describe('resolveFileOpenTarget', () => {
  beforeEach(() => {
    mockGetDatabase.mockReset();
  });

  function mockDbResult(mimeType?: string) {
    mockGetDatabase.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(mimeType ? [{ mimeType }] : [])
          })
        })
      })
    });
  }

  it('returns document for pdf files', async () => {
    mockDbResult('application/pdf');
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('document');
  });

  it('returns photo for image files', async () => {
    mockDbResult('image/png');
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('photo');
  });

  it('returns audio for audio files', async () => {
    mockDbResult('audio/mpeg');
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('audio');
  });

  it('returns video for video files', async () => {
    mockDbResult('video/mp4');
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('video');
  });

  it('returns file for unknown types', async () => {
    mockDbResult('application/octet-stream');
    await expect(resolveFileOpenTarget('file-1')).resolves.toBe('file');
  });

  it('returns file when no rows are found', async () => {
    mockDbResult();
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
});
