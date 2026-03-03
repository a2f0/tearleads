import { Code } from '@connectrpc/connect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  broadcastMock,
  getPostgresPoolMock,
  getActiveMlsGroupMembershipMock,
  parseSendMessagePayloadMock,
  queryMock,
  randomUuidMock,
  requireMlsClaimsMock,
  serializeEnvelopeFieldMock,
  shouldReadEnvelopeByteaMock
} = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  getActiveMlsGroupMembershipMock: vi.fn(),
  parseSendMessagePayloadMock: vi.fn(),
  queryMock: vi.fn(),
  randomUuidMock: vi.fn(),
  requireMlsClaimsMock: vi.fn(),
  serializeEnvelopeFieldMock: vi.fn(),
  shouldReadEnvelopeByteaMock: vi.fn()
}));

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => randomUuidMock(...args)
}));

vi.mock('../../lib/broadcast.js', () => ({
  broadcast: (...args: unknown[]) => broadcastMock(...args)
}));

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../routes/mls/shared.js', () => ({
  getActiveMlsGroupMembership: (...args: unknown[]) =>
    getActiveMlsGroupMembershipMock(...args),
  parseSendMessagePayload: (...args: unknown[]) =>
    parseSendMessagePayloadMock(...args)
}));

vi.mock('../../routes/vfs/crdtEnvelopeReadOptions.js', () => ({
  shouldReadEnvelopeBytea: (...args: unknown[]) =>
    shouldReadEnvelopeByteaMock(...args)
}));

vi.mock('../../routes/vfs/crdtEnvelopeStorage.js', () => ({
  serializeEnvelopeField: (...args: unknown[]) =>
    serializeEnvelopeFieldMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  getGroupMessagesDirect,
  sendGroupMessageDirect
} from './mlsDirectMessages.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error('Expected object JSON response');
  }

  return parsed;
}

describe('mlsDirectMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    requireMlsClaimsMock.mockResolvedValue({ sub: 'user-1' });
    getActiveMlsGroupMembershipMock.mockResolvedValue({
      role: 'member',
      organizationId: 'org-1'
    });
    parseSendMessagePayloadMock.mockReturnValue({
      ciphertext: 'ciphertext-1',
      epoch: 2,
      messageType: 'application',
      contentType: 'text/plain'
    });
    randomUuidMock.mockReturnValue('message-1');
    serializeEnvelopeFieldMock.mockReturnValue({
      text: 'ciphertext-1',
      bytes: new Uint8Array([1, 2, 3])
    });
    shouldReadEnvelopeByteaMock.mockReturnValue(false);
    broadcastMock.mockResolvedValue(undefined);
  });

  it('sends an MLS message and mirrors it into VFS CRDT storage', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 2 }] })
      .mockResolvedValueOnce({ rows: [{ sequence_number: 4 }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    const response = await sendGroupMessageDirect(
      { groupId: 'group-1', json: '{"ciphertext":"x"}' },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toMatchObject({
      message: {
        id: 'message-1',
        groupId: 'group-1',
        senderUserId: 'user-1',
        epoch: 2,
        messageType: 'application',
        contentType: 'text/plain',
        sequenceNumber: 5
      }
    });
    expect(broadcastMock).toHaveBeenCalledWith(
      'mls:group:group-1',
      expect.objectContaining({ type: 'mls:message' })
    );
  });

  it('rejects unsupported message types', async () => {
    parseSendMessagePayloadMock.mockReturnValueOnce({
      ciphertext: 'ciphertext-1',
      epoch: 2,
      messageType: 'commit',
      contentType: 'text/plain'
    });

    await expect(
      sendGroupMessageDirect(
        { groupId: 'group-1', json: '{"ciphertext":"x"}' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects invalid cursors when listing messages', async () => {
    await expect(
      getGroupMessagesDirect(
        { groupId: 'group-1', cursor: 'abc', limit: 20 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('lists messages with pagination metadata', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'message-3',
          group_id: 'group-1',
          sender_user_id: 'user-1',
          epoch: 3,
          ciphertext: 'cipher-3',
          encoded_content_type: 'text%2Fplain',
          legacy_content_type: null,
          sequence_number: 3,
          created_at: new Date('2026-03-03T03:15:00.000Z'),
          sender_email: 'user@example.com'
        },
        {
          id: 'message-2',
          group_id: 'group-1',
          sender_user_id: 'user-2',
          epoch: 3,
          ciphertext: 'cipher-2',
          encoded_content_type: 'text%2Fplain',
          legacy_content_type: null,
          sequence_number: 2,
          created_at: new Date('2026-03-03T03:14:00.000Z'),
          sender_email: null
        }
      ]
    });

    const response = await getGroupMessagesDirect(
      { groupId: 'group-1', cursor: '', limit: 1 },
      { requestHeader: new Headers() }
    );

    expect(parseJson(response.json)).toEqual({
      messages: [
        {
          id: 'message-3',
          groupId: 'group-1',
          senderUserId: 'user-1',
          senderEmail: 'user@example.com',
          epoch: 3,
          ciphertext: 'cipher-3',
          messageType: 'application',
          contentType: 'text/plain',
          sequenceNumber: 3,
          sentAt: '2026-03-03T03:15:00.000Z',
          createdAt: '2026-03-03T03:15:00.000Z'
        }
      ],
      hasMore: true,
      cursor: '3'
    });
  });
});
