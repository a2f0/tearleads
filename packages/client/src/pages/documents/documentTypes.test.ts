import { describe, expect, it } from 'vitest';
import { DOCUMENT_TYPE_MAP, getDocumentTypeLabel } from './documentTypes';

describe('documentTypes', () => {
  describe('DOCUMENT_TYPE_MAP', () => {
    it('contains expected mime types', () => {
      expect(DOCUMENT_TYPE_MAP['application/pdf']).toBe('PDF');
      expect(DOCUMENT_TYPE_MAP['text/plain']).toBe('Text');
      expect(DOCUMENT_TYPE_MAP['text/markdown']).toBe('Markdown');
      expect(DOCUMENT_TYPE_MAP['text/csv']).toBe('CSV');
      expect(DOCUMENT_TYPE_MAP['application/json']).toBe('JSON');
    });
  });

  describe('getDocumentTypeLabel', () => {
    it('returns mapped label for known mime types', () => {
      expect(getDocumentTypeLabel('application/pdf')).toBe('PDF');
      expect(getDocumentTypeLabel('text/plain')).toBe('Text');
    });

    it('returns uppercase subtype for unknown mime types', () => {
      expect(getDocumentTypeLabel('image/png')).toBe('PNG');
      expect(getDocumentTypeLabel('audio/mp3')).toBe('MP3');
    });

    it('returns Document for mime types without subtype', () => {
      expect(getDocumentTypeLabel('unknown')).toBe('Document');
      expect(getDocumentTypeLabel('')).toBe('Document');
    });
  });
});
