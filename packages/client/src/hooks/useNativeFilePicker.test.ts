import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMON_AUDIO_MIME_TYPES,
  useNativeFilePicker
} from './useNativeFilePicker';

vi.mock('../lib/utils', () => ({
  detectPlatform: vi.fn()
}));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: {
    pickFiles: vi.fn(),
    pickImages: vi.fn(),
    pickMedia: vi.fn()
  }
}));

import { FilePicker } from '@capawesome/capacitor-file-picker';
import { detectPlatform } from '../lib/utils';

describe('useNativeFilePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on web platform', () => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('web');
    });

    it('returns isNativePicker as false', () => {
      const { result } = renderHook(() => useNativeFilePicker());
      expect(result.current.isNativePicker).toBe(false);
    });

    it('pickFiles returns null to signal fallback', async () => {
      const { result } = renderHook(() => useNativeFilePicker());

      let files: File[] | null = [];
      await act(async () => {
        files = await result.current.pickFiles({ accept: 'audio/*' });
      });

      expect(files).toBeNull();
      expect(FilePicker.pickFiles).not.toHaveBeenCalled();
    });
  });

  describe('on iOS platform', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('ios');
      fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }))
        );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('returns isNativePicker as true', () => {
      const { result } = renderHook(() => useNativeFilePicker());
      expect(result.current.isNativePicker).toBe(true);
    });

    it('pickFiles calls FilePicker.pickFiles with correct options', async () => {
      vi.mocked(FilePicker.pickFiles).mockResolvedValue({
        files: [
          {
            name: 'test.mp3',
            mimeType: 'audio/mpeg',
            size: 1024,
            data: btoa('test audio content')
          }
        ]
      });

      const { result } = renderHook(() => useNativeFilePicker());

      const filesResult: { value: File[] | null } = { value: null };
      await act(async () => {
        filesResult.value = await result.current.pickFiles({
          accept: 'audio/*',
          multiple: false
        });
      });

      // audio/* is expanded to specific MIME types for better iOS filtering
      expect(FilePicker.pickFiles).toHaveBeenCalledWith({
        types: COMMON_AUDIO_MIME_TYPES,
        limit: 1,
        readData: true
      });

      const files = filesResult.value;
      expect(files).not.toBeNull();
      expect(files).toHaveLength(1);
      expect(files?.[0]?.name).toBe('test.mp3');
      expect(files?.[0]?.type).toBe('audio/mpeg');
    });

    it('pickFiles with multiple=true sets limit to 0', async () => {
      vi.mocked(FilePicker.pickFiles).mockResolvedValue({
        files: []
      });

      const { result } = renderHook(() => useNativeFilePicker());

      await act(async () => {
        await result.current.pickFiles({
          accept: 'audio/*',
          multiple: true
        });
      });

      expect(FilePicker.pickFiles).toHaveBeenCalledWith({
        types: COMMON_AUDIO_MIME_TYPES,
        limit: 0,
        readData: true
      });
    });

    it('pickFiles returns empty array when no files selected', async () => {
      vi.mocked(FilePicker.pickFiles).mockResolvedValue({
        files: []
      });

      const { result } = renderHook(() => useNativeFilePicker());

      let files: File[] | null = null;
      await act(async () => {
        files = await result.current.pickFiles({ accept: 'audio/*' });
      });

      expect(files).toEqual([]);
    });

    it('pickFiles parses comma-separated accept types', async () => {
      vi.mocked(FilePicker.pickFiles).mockResolvedValue({
        files: []
      });

      const { result } = renderHook(() => useNativeFilePicker());

      await act(async () => {
        await result.current.pickFiles({
          accept: 'audio/*,video/*'
        });
      });

      // audio/* is expanded, video/* passes through as-is
      expect(FilePicker.pickFiles).toHaveBeenCalledWith({
        types: [...COMMON_AUDIO_MIME_TYPES, 'video/*'],
        limit: 1,
        readData: true
      });
    });

    it('pickFiles without accept does not include types', async () => {
      vi.mocked(FilePicker.pickFiles).mockResolvedValue({
        files: []
      });

      const { result } = renderHook(() => useNativeFilePicker());

      await act(async () => {
        await result.current.pickFiles({});
      });

      expect(FilePicker.pickFiles).toHaveBeenCalledWith({
        limit: 1,
        readData: true
      });
    });

    it('pickFiles with source="photos" calls FilePicker.pickImages', async () => {
      vi.mocked(FilePicker.pickImages).mockResolvedValue({
        files: [
          {
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 2048,
            data: btoa('photo content')
          }
        ]
      });

      const { result } = renderHook(() => useNativeFilePicker());

      const filesResult: { value: File[] | null } = { value: null };
      await act(async () => {
        filesResult.value = await result.current.pickFiles({
          source: 'photos',
          multiple: true
        });
      });

      expect(FilePicker.pickImages).toHaveBeenCalledWith({
        limit: 0,
        readData: true
      });
      expect(FilePicker.pickFiles).not.toHaveBeenCalled();
      expect(filesResult.value).toHaveLength(1);
      expect(filesResult.value?.[0]?.name).toBe('photo.jpg');
    });

    it('pickFiles with source="media" calls FilePicker.pickMedia', async () => {
      vi.mocked(FilePicker.pickMedia).mockResolvedValue({
        files: [
          {
            name: 'video.mp4',
            mimeType: 'video/mp4',
            size: 4096,
            data: btoa('video content')
          }
        ]
      });

      const { result } = renderHook(() => useNativeFilePicker());

      const filesResult: { value: File[] | null } = { value: null };
      await act(async () => {
        filesResult.value = await result.current.pickFiles({
          source: 'media',
          multiple: false
        });
      });

      expect(FilePicker.pickMedia).toHaveBeenCalledWith({
        limit: 1,
        readData: true
      });
      expect(FilePicker.pickFiles).not.toHaveBeenCalled();
      expect(filesResult.value).toHaveLength(1);
      expect(filesResult.value?.[0]?.name).toBe('video.mp4');
    });

    it('pickFiles with source="files" (default) calls FilePicker.pickFiles', async () => {
      vi.mocked(FilePicker.pickFiles).mockResolvedValue({
        files: []
      });

      const { result } = renderHook(() => useNativeFilePicker());

      await act(async () => {
        await result.current.pickFiles({
          source: 'files',
          accept: 'audio/*'
        });
      });

      expect(FilePicker.pickFiles).toHaveBeenCalledWith({
        types: COMMON_AUDIO_MIME_TYPES,
        limit: 1,
        readData: true
      });
      expect(FilePicker.pickImages).not.toHaveBeenCalled();
      expect(FilePicker.pickMedia).not.toHaveBeenCalled();
    });
  });

  describe('on Android platform', () => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('android');
    });

    it('returns isNativePicker as false (only iOS uses native picker)', () => {
      const { result } = renderHook(() => useNativeFilePicker());
      expect(result.current.isNativePicker).toBe(false);
    });

    it('pickFiles returns null to signal fallback', async () => {
      const { result } = renderHook(() => useNativeFilePicker());

      let files: File[] | null = [];
      await act(async () => {
        files = await result.current.pickFiles({ accept: 'audio/*' });
      });

      expect(files).toBeNull();
      expect(FilePicker.pickFiles).not.toHaveBeenCalled();
    });
  });
});
