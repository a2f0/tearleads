import { describe, expect, it } from 'vitest';
import { filterFilesByAccept } from './fileFilter';

function createMockFile(name: string, type: string): File {
  return new File(['content'], name, { type });
}

/** Helper: check if a single file matches a given accept string. */
function matchesSingle(file: File, accept: string): boolean {
  return filterFilesByAccept([file], accept).length === 1;
}

describe('file-filter', () => {
  describe('single-file matching', () => {
    describe('wildcard MIME types', () => {
      it('matches image/* with image/jpeg', () => {
        const file = createMockFile('photo.jpg', 'image/jpeg');
        expect(matchesSingle(file, 'image/*')).toBe(true);
      });

      it('matches image/* with image/png', () => {
        const file = createMockFile('photo.png', 'image/png');
        expect(matchesSingle(file, 'image/*')).toBe(true);
      });

      it('matches video/* with video/mp4', () => {
        const file = createMockFile('video.mp4', 'video/mp4');
        expect(matchesSingle(file, 'video/*')).toBe(true);
      });

      it('matches audio/* with audio/mpeg', () => {
        const file = createMockFile('song.mp3', 'audio/mpeg');
        expect(matchesSingle(file, 'audio/*')).toBe(true);
      });

      it('does not match image/* with video/mp4', () => {
        const file = createMockFile('video.mp4', 'video/mp4');
        expect(matchesSingle(file, 'image/*')).toBe(false);
      });
    });

    describe('exact MIME types', () => {
      it('matches application/pdf with pdf file', () => {
        const file = createMockFile('doc.pdf', 'application/pdf');
        expect(matchesSingle(file, 'application/pdf')).toBe(true);
      });

      it('does not match application/pdf with text file', () => {
        const file = createMockFile('doc.txt', 'text/plain');
        expect(matchesSingle(file, 'application/pdf')).toBe(false);
      });
    });

    describe('file extensions', () => {
      it('matches .iso extension', () => {
        const file = createMockFile('linux.iso', 'application/x-iso9660-image');
        expect(matchesSingle(file, '.iso')).toBe(true);
      });

      it('matches .iso extension case-insensitively', () => {
        const file = createMockFile('linux.ISO', 'application/x-iso9660-image');
        expect(matchesSingle(file, '.iso')).toBe(true);
      });

      it('matches .csv extension', () => {
        const file = createMockFile('data.csv', 'text/csv');
        expect(matchesSingle(file, '.csv')).toBe(true);
      });

      it('does not match .iso extension for pdf file', () => {
        const file = createMockFile('doc.pdf', 'application/pdf');
        expect(matchesSingle(file, '.iso')).toBe(false);
      });
    });

    describe('comma-separated accept strings', () => {
      it('matches first type in list', () => {
        const file = createMockFile('doc.pdf', 'application/pdf');
        expect(matchesSingle(file, 'application/pdf,text/*')).toBe(true);
      });

      it('matches second type in list', () => {
        const file = createMockFile('readme.txt', 'text/plain');
        expect(matchesSingle(file, 'application/pdf,text/*')).toBe(true);
      });

      it('matches wildcard in comma-separated list', () => {
        const file = createMockFile('image.png', 'image/png');
        expect(matchesSingle(file, 'video/*,image/*,audio/*')).toBe(true);
      });

      it('matches extension in mixed list', () => {
        const file = createMockFile('linux.iso', 'application/x-iso9660-image');
        expect(matchesSingle(file, '.iso,application/x-iso9660-image')).toBe(
          true
        );
      });

      it('handles spaces after commas', () => {
        const file = createMockFile('photo.jpg', 'image/jpeg');
        expect(matchesSingle(file, 'video/*, image/*, audio/*')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('returns true for empty accept string', () => {
        const file = createMockFile('any.file', 'application/octet-stream');
        expect(matchesSingle(file, '')).toBe(true);
      });

      it('returns true for whitespace-only accept string', () => {
        const file = createMockFile('any.file', 'application/octet-stream');
        expect(matchesSingle(file, '   ')).toBe(true);
      });

      it('handles file with empty MIME type', () => {
        const file = createMockFile('unknown.xyz', '');
        expect(matchesSingle(file, 'image/*')).toBe(false);
      });

      it('does not partially match MIME types', () => {
        const file = createMockFile('image.jpg', 'image/jpeg');
        expect(matchesSingle(file, 'imag/*')).toBe(false);
      });
    });
  });

  describe('filterFilesByAccept', () => {
    it('filters files to only matching types', () => {
      const files = [
        createMockFile('photo.jpg', 'image/jpeg'),
        createMockFile('video.mp4', 'video/mp4'),
        createMockFile('photo2.png', 'image/png')
      ];

      const result = filterFilesByAccept(files, 'image/*');

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('photo.jpg');
      expect(result[1]?.name).toBe('photo2.png');
    });

    it('returns all files when accept is undefined', () => {
      const files = [
        createMockFile('photo.jpg', 'image/jpeg'),
        createMockFile('video.mp4', 'video/mp4')
      ];

      const result = filterFilesByAccept(files, undefined);

      expect(result).toHaveLength(2);
    });

    it('returns all files when accept is empty string', () => {
      const files = [
        createMockFile('photo.jpg', 'image/jpeg'),
        createMockFile('doc.pdf', 'application/pdf')
      ];

      const result = filterFilesByAccept(files, '');

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no files match', () => {
      const files = [
        createMockFile('video.mp4', 'video/mp4'),
        createMockFile('audio.mp3', 'audio/mpeg')
      ];

      const result = filterFilesByAccept(files, 'image/*');

      expect(result).toHaveLength(0);
    });

    it('handles empty input array', () => {
      const result = filterFilesByAccept([], 'image/*');

      expect(result).toHaveLength(0);
    });

    it('works with comma-separated accept strings', () => {
      const files = [
        createMockFile('photo.jpg', 'image/jpeg'),
        createMockFile('video.mp4', 'video/mp4'),
        createMockFile('doc.pdf', 'application/pdf'),
        createMockFile('song.mp3', 'audio/mpeg')
      ];

      const result = filterFilesByAccept(files, 'image/*,application/pdf');

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('photo.jpg');
      expect(result[1]?.name).toBe('doc.pdf');
    });
  });
});
