import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  InboundMessageEnvelopeRecord,
  ResolvedInboundRecipient
} from '../types/inboundContracts.js';

const { getPostgresPoolMock, randomUuidMock } = vi.hoisted(() => ({
  getPostgresPoolMock: vi.fn(),
  randomUuidMock: vi.fn()
}));

vi.mock('./postgres.js', () => ({
  getPostgresPool: getPostgresPoolMock
}));

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return {
    ...original,
    randomUUID: randomUuidMock
  };
});

function buildEnvelope(): InboundMessageEnvelopeRecord {
  return {
    messageId: 'msg-1',
    from: { address: 'sender@test.com' },
    to: [{ address: 'user-1@test.com' }],
    receivedAt: '2026-02-23T00:00:00.000Z',
    encryptedSubject: 'enc-subject',
    encryptedFrom: 'enc-from',
    encryptedTo: ['enc-to'],
    encryptedBodyPointer: 'smtp/inbound/msg-1.bin',
    encryptedBodySha256: 'abc123',
    encryptedBodySize: 123,
    wrappedRecipientKeys: [
      {
        userId: 'someone-else',
        wrappedDek: 'unused',
        keyAlgorithm: 'x25519-mlkem768-v1'
      },
      {
        userId: 'user-1',
        wrappedDek: 'wrapped-dek',
        keyAlgorithm: 'x25519-mlkem768-v1'
      }
    ]
  };
}

function buildRecipients(): ResolvedInboundRecipient[] {
  return [
    {
      userId: 'user-1',
      address: 'user-1@test.com'
    }
  ];
}

describe('PostgresInboundVfsEmailRepository', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    let counter = 0;
    randomUuidMock.mockImplementation(() => {
      counter += 1;
      return `uuid-${counter}`;
    });
  });

  it('returns early when there are no recipients', async () => {
    const { PostgresInboundVfsEmailRepository } = await import(
      './inboundVfsRepository.js'
    );

    await new PostgresInboundVfsEmailRepository().persistInboundMessage({
      envelope: buildEnvelope(),
      recipients: []
    });

    expect(getPostgresPoolMock).not.toHaveBeenCalled();
  });

  it('persists inbound data and commits when inbox already exists', async () => {
    const clientQueryMock = vi.fn(async (query: string) => {
      if (query.includes('FROM email_folders')) {
        return { rows: [{ id: 'existing-inbox' }] };
      }
      return { rows: [] };
    });
    const releaseMock = vi.fn();
    const connectMock = vi.fn(async () => ({
      query: clientQueryMock,
      release: releaseMock
    }));

    getPostgresPoolMock.mockResolvedValue({ connect: connectMock });

    const { PostgresInboundVfsEmailRepository } = await import(
      './inboundVfsRepository.js'
    );

    await new PostgresInboundVfsEmailRepository().persistInboundMessage({
      envelope: buildEnvelope(),
      recipients: buildRecipients()
    });

    expect(connectMock).toHaveBeenCalledOnce();
    expect(clientQueryMock).toHaveBeenCalledWith('BEGIN');
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO emails'),
      expect.any(Array)
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO vfs_acl_entries'),
      expect.arrayContaining(['user-1', 'wrapped-dek'])
    );
    expect(clientQueryMock).toHaveBeenCalledWith('COMMIT');
    expect(clientQueryMock).not.toHaveBeenCalledWith('ROLLBACK');
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it('creates an inbox folder when one does not exist', async () => {
    const clientQueryMock = vi.fn(async (query: string) => {
      if (query.includes('FROM email_folders')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const releaseMock = vi.fn();

    getPostgresPoolMock.mockResolvedValue({
      connect: vi.fn(async () => ({
        query: clientQueryMock,
        release: releaseMock
      }))
    });

    const { PostgresInboundVfsEmailRepository } = await import(
      './inboundVfsRepository.js'
    );

    await new PostgresInboundVfsEmailRepository().persistInboundMessage({
      envelope: buildEnvelope(),
      recipients: buildRecipients()
    });

    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'INSERT INTO vfs_registry (id, object_type, owner_id, created_at)'
      ),
      [expect.stringMatching(/^uuid-\d+$/), 'user-1']
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO email_folders'),
      [expect.stringMatching(/^uuid-\d+$/), 'inbox']
    );
    expect(clientQueryMock).toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it('rolls back and throws when wrapped key is missing', async () => {
    const clientQueryMock = vi.fn(async (query: string) => {
      if (query.includes('FROM email_folders')) {
        return { rows: [{ id: 'existing-inbox' }] };
      }
      return { rows: [] };
    });
    const releaseMock = vi.fn();

    getPostgresPoolMock.mockResolvedValue({
      connect: vi.fn(async () => ({
        query: clientQueryMock,
        release: releaseMock
      }))
    });

    const { PostgresInboundVfsEmailRepository } = await import(
      './inboundVfsRepository.js'
    );
    const envelope = buildEnvelope();
    envelope.wrappedRecipientKeys = [];

    await expect(
      new PostgresInboundVfsEmailRepository().persistInboundMessage({
        envelope,
        recipients: buildRecipients()
      })
    ).rejects.toThrow('Missing wrapped key envelope for recipient user-1');

    expect(clientQueryMock).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQueryMock).not.toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it('rolls back when a query fails after begin', async () => {
    const clientQueryMock = vi.fn(async (query: string) => {
      if (query.includes('INSERT INTO vfs_acl_entries')) {
        throw new Error('db failure');
      }
      if (query.includes('FROM email_folders')) {
        return { rows: [{ id: 'existing-inbox' }] };
      }
      return { rows: [] };
    });
    const releaseMock = vi.fn();

    getPostgresPoolMock.mockResolvedValue({
      connect: vi.fn(async () => ({
        query: clientQueryMock,
        release: releaseMock
      }))
    });

    const { PostgresInboundVfsEmailRepository } = await import(
      './inboundVfsRepository.js'
    );

    await expect(
      new PostgresInboundVfsEmailRepository().persistInboundMessage({
        envelope: buildEnvelope(),
        recipients: buildRecipients()
      })
    ).rejects.toThrow('db failure');

    expect(clientQueryMock).toHaveBeenCalledWith('ROLLBACK');
    expect(clientQueryMock).not.toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
