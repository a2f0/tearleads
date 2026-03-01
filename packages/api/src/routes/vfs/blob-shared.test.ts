import { describe, expect, it } from 'vitest';
import {
  isPostgresErrorWithCode,
  normalizeRequiredString,
  parseBlobAttachBody,
  parseBlobStageBody,
  toIsoFromDateOrString
} from './blob-shared.js';

describe('blob-shared', () => {
  describe('normalizeRequiredString', () => {
    it('returns null for non-string values', () => {
      expect(normalizeRequiredString(null)).toBeNull();
      expect(normalizeRequiredString(123)).toBeNull();
    });

    it('trims and validates string values', () => {
      expect(normalizeRequiredString('   ')).toBeNull();
      expect(normalizeRequiredString('  hello  ')).toBe('hello');
    });
  });

  describe('parseBlobStageBody', () => {
    it('returns null for non-record payloads', () => {
      expect(parseBlobStageBody(null)).toBeNull();
      expect(parseBlobStageBody('bad payload')).toBeNull();
    });

    it('returns null when required fields are missing', () => {
      expect(parseBlobStageBody({ blobId: 'blob-1' })).toBeNull();
      expect(
        parseBlobStageBody({
          expiresAt: '2099-02-14T11:00:00.000Z'
        })
      ).toBeNull();
    });

    it('returns parsed body when stagingId is provided', () => {
      expect(
        parseBlobStageBody({
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z'
        })
      ).toEqual({
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2099-02-14T11:00:00.000Z',
        dataBase64: null,
        contentType: null
      });
    });

    it('generates a staging id when one is not provided', () => {
      const parsed = parseBlobStageBody({
        blobId: 'blob-1',
        expiresAt: '2099-02-14T11:00:00.000Z'
      });

      expect(parsed).not.toBeNull();
      expect(parsed?.blobId).toBe('blob-1');
      expect(parsed?.expiresAt).toBe('2099-02-14T11:00:00.000Z');
      expect(parsed?.dataBase64).toBeNull();
      expect(parsed?.contentType).toBeNull();
      expect(typeof parsed?.stagingId).toBe('string');
      expect(parsed?.stagingId.length).toBeGreaterThan(0);
    });

    it('accepts optional inbound blob payload fields', () => {
      expect(
        parseBlobStageBody({
          stagingId: 'stage-1',
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: 'SGVsbG8=',
          contentType: 'text/plain'
        })
      ).toEqual({
        stagingId: 'stage-1',
        blobId: 'blob-1',
        expiresAt: '2099-02-14T11:00:00.000Z',
        dataBase64: 'SGVsbG8=',
        contentType: 'text/plain'
      });
    });

    it('rejects non-string optional inbound blob payload fields', () => {
      expect(
        parseBlobStageBody({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z',
          dataBase64: 42
        })
      ).toBeNull();
      expect(
        parseBlobStageBody({
          blobId: 'blob-1',
          expiresAt: '2099-02-14T11:00:00.000Z',
          contentType: false
        })
      ).toBeNull();
    });
  });

  describe('parseBlobAttachBody', () => {
    it('returns null for invalid payloads', () => {
      expect(parseBlobAttachBody(null)).toBeNull();
      expect(parseBlobAttachBody({})).toBeNull();
      expect(
        parseBlobAttachBody({ itemId: 'item-1', relationKind: 42 })
      ).toBeNull();
      expect(
        parseBlobAttachBody({ itemId: 'item-1', relationKind: 'invalid' })
      ).toBeNull();
    });

    it('defaults relationKind to file when omitted', () => {
      expect(parseBlobAttachBody({ itemId: 'item-1' })).toEqual({
        itemId: 'item-1',
        relationKind: 'file'
      });
    });

    it('accepts valid relation kinds', () => {
      expect(
        parseBlobAttachBody({
          itemId: 'item-1',
          relationKind: 'emailAttachment'
        })
      ).toEqual({
        itemId: 'item-1',
        relationKind: 'emailAttachment'
      });
      expect(
        parseBlobAttachBody({ itemId: 'item-1', relationKind: 'other' })
      ).toEqual({
        itemId: 'item-1',
        relationKind: 'other'
      });
    });
  });

  describe('toIsoFromDateOrString', () => {
    it('returns iso for Date values', () => {
      expect(toIsoFromDateOrString(new Date('2026-02-14T10:00:00.000Z'))).toBe(
        '2026-02-14T10:00:00.000Z'
      );
    });

    it('normalizes parseable strings and preserves invalid ones', () => {
      expect(toIsoFromDateOrString('2026-02-14T10:00:00Z')).toBe(
        '2026-02-14T10:00:00.000Z'
      );
      expect(toIsoFromDateOrString('not-a-date')).toBe('not-a-date');
    });
  });

  describe('isPostgresErrorWithCode', () => {
    it('returns true only for matching postgres error code', () => {
      expect(isPostgresErrorWithCode({ code: '23505' }, '23505')).toBe(true);
      expect(isPostgresErrorWithCode({ code: '23503' }, '23505')).toBe(false);
      expect(isPostgresErrorWithCode(new Error('boom'), '23505')).toBe(false);
      expect(isPostgresErrorWithCode(null, '23505')).toBe(false);
    });
  });
});
