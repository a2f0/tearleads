import {
  combinePublicKey,
  extractPublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import type {
  InboundBlobStore,
  InboundRecipientKeyLookup,
  InboundVfsEmailRepository
} from '../types/inboundContracts.js';
import { DefaultInboundMessageIngestor } from './inboundIngest.js';

function buildPublicKeyString(): string {
  const keyPair = generateKeyPair();
  const serialized = serializePublicKey(extractPublicKey(keyPair));
  return combinePublicKey(serialized);
}

describe('DefaultInboundMessageIngestor', () => {
  it('encrypts payload and persists recipient fanout envelope', async () => {
    const keyLookup: InboundRecipientKeyLookup = {
      getPublicEncryptionKeys: vi.fn(
        async () =>
          new Map([
            [
              '11111111-1111-4111-8111-111111111111',
              {
                userId: '11111111-1111-4111-8111-111111111111',
                publicEncryptionKey: buildPublicKeyString()
              }
            ]
          ])
      )
    };
    const blobStore: InboundBlobStore = {
      putEncryptedMessage: vi.fn(async () => ({
        storageKey: 'smtp/inbound/msg.bin',
        sha256: 'abc123',
        ciphertextSize: 200
      }))
    };
    const repository: InboundVfsEmailRepository = {
      persistInboundMessage: vi.fn(async () => {})
    };

    const ingestor = new DefaultInboundMessageIngestor(
      keyLookup,
      blobStore,
      repository
    );
    await ingestor.ingest({
      email: {
        id: 'msg-1',
        envelope: {
          mailFrom: { address: 'sender@test.com' },
          rcptTo: [{ address: '11111111-1111-4111-8111-111111111111@test.com' }]
        },
        rawData: 'Subject: Hello\r\n\r\nBody',
        receivedAt: '2026-02-23T00:00:00.000Z',
        size: 20
      },
      userIds: ['11111111-1111-4111-8111-111111111111']
    });

    expect(blobStore.putEncryptedMessage).toHaveBeenCalledOnce();
    expect(repository.persistInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          messageId: 'msg-1',
          encryptedBodyPointer: 'smtp/inbound/msg.bin',
          encryptedBodySha256: 'abc123',
          encryptedBodySize: 200
        }),
        recipients: [
          {
            userId: '11111111-1111-4111-8111-111111111111',
            address: '11111111-1111-4111-8111-111111111111@test.com'
          }
        ]
      })
    );
  });

  it('fails when recipient key is missing', async () => {
    const keyLookup: InboundRecipientKeyLookup = {
      getPublicEncryptionKeys: vi.fn(async () => new Map())
    };
    const blobStore: InboundBlobStore = {
      putEncryptedMessage: vi.fn(async () => ({
        storageKey: 'smtp/inbound/msg.bin',
        sha256: 'abc123',
        ciphertextSize: 200
      }))
    };
    const repository: InboundVfsEmailRepository = {
      persistInboundMessage: vi.fn(async () => {})
    };

    const ingestor = new DefaultInboundMessageIngestor(
      keyLookup,
      blobStore,
      repository
    );
    await expect(
      ingestor.ingest({
        email: {
          id: 'msg-1',
          envelope: {
            mailFrom: { address: 'sender@test.com' },
            rcptTo: [
              { address: '11111111-1111-4111-8111-111111111111@test.com' }
            ]
          },
          rawData: 'Subject: Hello\r\n\r\nBody',
          receivedAt: '2026-02-23T00:00:00.000Z',
          size: 20
        },
        userIds: ['11111111-1111-4111-8111-111111111111']
      })
    ).rejects.toThrow('Missing recipient key');
    expect(repository.persistInboundMessage).not.toHaveBeenCalled();
  });

  it('returns immediately when no recipients are provided', async () => {
    const keyLookup: InboundRecipientKeyLookup = {
      getPublicEncryptionKeys: vi.fn(async () => new Map())
    };
    const blobStore: InboundBlobStore = {
      putEncryptedMessage: vi.fn(async () => ({
        storageKey: 'smtp/inbound/msg.bin',
        sha256: 'abc123',
        ciphertextSize: 200
      }))
    };
    const repository: InboundVfsEmailRepository = {
      persistInboundMessage: vi.fn(async () => {})
    };

    const ingestor = new DefaultInboundMessageIngestor(
      keyLookup,
      blobStore,
      repository
    );

    await ingestor.ingest({
      email: {
        id: 'msg-no-recipient',
        envelope: {
          mailFrom: false,
          rcptTo: []
        },
        rawData: 'Subject: ignored',
        receivedAt: '2026-02-23T00:00:00.000Z',
        size: 0
      },
      userIds: []
    });

    expect(keyLookup.getPublicEncryptionKeys).not.toHaveBeenCalled();
    expect(blobStore.putEncryptedMessage).not.toHaveBeenCalled();
    expect(repository.persistInboundMessage).not.toHaveBeenCalled();
  });

  it('falls back to unknown recipient address and empty subject', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const keyLookup: InboundRecipientKeyLookup = {
      getPublicEncryptionKeys: vi.fn(
        async () =>
          new Map([
            [
              userId,
              {
                userId,
                publicEncryptionKey: buildPublicKeyString()
              }
            ]
          ])
      )
    };
    const blobStore: InboundBlobStore = {
      putEncryptedMessage: vi.fn(async () => ({
        storageKey: 'smtp/inbound/msg.bin',
        sha256: 'abc123',
        ciphertextSize: 200
      }))
    };
    const repository: InboundVfsEmailRepository = {
      persistInboundMessage: vi.fn(async () => {})
    };

    const ingestor = new DefaultInboundMessageIngestor(
      keyLookup,
      blobStore,
      repository
    );

    await ingestor.ingest({
      email: {
        id: 'msg-no-subject',
        envelope: {
          mailFrom: false,
          rcptTo: [{ address: 'not-an-email-address' }]
        },
        rawData: 'X-Test: value\n\nbody',
        receivedAt: '2026-02-23T00:00:00.000Z',
        size: 20
      },
      userIds: [userId]
    });

    expect(repository.persistInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          from: false
        }),
        recipients: [{ userId, address: `${userId}@unknown` }]
      })
    );
  });
});
