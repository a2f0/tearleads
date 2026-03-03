import { describe, expect, it, vi } from 'vitest';

const { serializeEnvelopeFieldMock } = vi.hoisted(() => ({
  serializeEnvelopeFieldMock: vi.fn()
}));

vi.mock('./vfsDirectCrdtEnvelopeStorage.js', () => ({
  serializeEnvelopeField: (...args: unknown[]) =>
    serializeEnvelopeFieldMock(...args)
}));

import {
  acquireTransactionClient,
  decodeContentTypeFromSourceId,
  persistApplicationMessageToVfs,
  toIsoString,
  toPositiveInteger
} from './mlsDirectMessagesShared.js';

describe('mlsDirectMessagesShared', () => {
  it('normalizes positive integer values', () => {
    expect(toPositiveInteger(3.8)).toBe(3);
    expect(toPositiveInteger('7')).toBe(7);
    expect(toPositiveInteger(-5)).toBe(0);
    expect(toPositiveInteger('bad')).toBe(0);
  });

  it('decodes content types with sensible fallbacks', () => {
    expect(decodeContentTypeFromSourceId('text%2Fplain', null)).toBe(
      'text/plain'
    );
    expect(decodeContentTypeFromSourceId(null, 'text/custom')).toBe(
      'text/custom'
    );
    expect(decodeContentTypeFromSourceId(null, null)).toBe('text/plain');
    expect(decodeContentTypeFromSourceId('%E0%A4%A', null)).toBe('text/plain');
  });

  it('normalizes date and string timestamps', () => {
    const date = new Date('2026-03-03T03:00:00.000Z');
    expect(toIsoString(date)).toBe('2026-03-03T03:00:00.000Z');
    expect(toIsoString('2026-03-03T03:00:00.000Z')).toBe(
      '2026-03-03T03:00:00.000Z'
    );
  });

  it('acquires a transaction client from pool.query fallback when connect is absent', async () => {
    const poolQueryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = await acquireTransactionClient({ query: poolQueryMock });

    await client.query('SELECT 1', ['a']);
    client.release();

    expect(poolQueryMock).toHaveBeenCalledWith('SELECT 1', ['a']);
  });

  it('acquires and releases connected clients when connect is present', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const releaseMock = vi.fn();

    const client = await acquireTransactionClient({
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: releaseMock
      })
    });

    await client.query('SELECT 1', ['b']);
    client.release();

    expect(clientQueryMock).toHaveBeenCalledWith('SELECT 1', ['b']);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('persists mirrored MLS messages across VFS tables', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    serializeEnvelopeFieldMock.mockReturnValue({
      text: 'ciphertext-value',
      bytes: new Uint8Array([1, 2, 3])
    });

    await persistApplicationMessageToVfs(
      {
        query: queryMock,
        release: vi.fn()
      },
      {
        messageId: 'message-1',
        groupId: 'group-1',
        senderUserId: 'user-1',
        ciphertext: 'ciphertext-value',
        contentType: 'text/plain',
        epoch: 2,
        occurredAtIso: '2026-03-03T03:20:00.000Z',
        sequenceNumber: 4
      }
    );

    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(queryMock.mock.calls[3]?.[1]).toEqual([
      'message-1',
      'user-1',
      'mls_message:group-1:4:message-1:text%2Fplain',
      '2026-03-03T03:20:00.000Z',
      'ciphertext-value',
      new Uint8Array([1, 2, 3]),
      2
    ]);
  });
});
