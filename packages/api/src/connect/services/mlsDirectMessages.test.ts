import { Code } from '@connectrpc/connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  broadcastMock,
  getPostgresPoolMock,
  getActiveMlsGroupMembershipMock,
  queryMock,
  randomUuidMock,
  requireMlsClaimsMock,
  serializeEnvelopeFieldMock
} = vi.hoisted(() => ({
  broadcastMock: vi.fn(),
  getPostgresPoolMock: vi.fn(),
  getActiveMlsGroupMembershipMock: vi.fn(),
  queryMock: vi.fn(),
  randomUuidMock: vi.fn(),
  requireMlsClaimsMock: vi.fn(),
  serializeEnvelopeFieldMock: vi.fn()
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

vi.mock('./mlsDirectShared.js', () => ({
  getActiveMlsGroupMembership: (...args: unknown[]) =>
    getActiveMlsGroupMembershipMock(...args)
}));

vi.mock('./vfsDirectCrdtEnvelopeStorage.js', () => ({
  serializeEnvelopeField: (...args: unknown[]) =>
    serializeEnvelopeFieldMock(...args)
}));

vi.mock('./mlsDirectAuth.js', () => ({
  requireMlsClaims: (...args: unknown[]) => requireMlsClaimsMock(...args)
}));

import {
  getGroupMessagesDirectTyped,
  sendGroupMessageDirectTyped
} from './mlsDirectMessages.js';

const SEND_MESSAGE_REQUEST: {
  groupId: string;
  ciphertext: string;
  epoch: number;
  messageType: 'application';
  contentType: string;
} = {
  groupId: 'group-1',
  ciphertext: 'ciphertext-1',
  epoch: 2,
  messageType: 'application',
  contentType: 'text/plain'
};

describe('mlsDirectMessages', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();

    getPostgresPoolMock.mockResolvedValue({ query: queryMock });
    requireMlsClaimsMock.mockResolvedValue({ sub: 'user-1' });
    getActiveMlsGroupMembershipMock.mockResolvedValue({
      role: 'member',
      organizationId: 'org-1'
    });
    randomUuidMock.mockReturnValue('message-1');
    serializeEnvelopeFieldMock.mockReturnValue({
      text: 'ciphertext-1',
      bytes: new Uint8Array([1, 2, 3])
    });
    broadcastMock.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
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

    const response = await sendGroupMessageDirectTyped(SEND_MESSAGE_REQUEST, {
      requestHeader: new Headers()
    });

    expect(requireMlsClaimsMock).toHaveBeenCalledWith(
      '/mls/groups/group-1/messages',
      expect.any(Headers)
    );
    expect(response).toMatchObject({
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

    const maxSequenceQuery = clientQueryMock.mock.calls
      .map((call) => call[0])
      .find(
        (queryText) =>
          typeof queryText === 'string' &&
          queryText.includes('FROM vfs_crdt_ops')
      );
    expect(typeof maxSequenceQuery).toBe('string');
    if (typeof maxSequenceQuery !== 'string') {
      throw new Error('Expected max sequence query to run');
    }
    expect(maxSequenceQuery).toContain("source_table = 'mls_message'");
    expect(maxSequenceQuery).not.toContain(
      "source_table IN ('mls_messages', 'mls_message')"
    );

    expect(broadcastMock).toHaveBeenCalledWith(
      'mls:group:group-1',
      expect.objectContaining({ type: 'mls:message' })
    );
  });

  it('rejects invalid send payloads', async () => {
    await expect(
      sendGroupMessageDirectTyped(
        { ...SEND_MESSAGE_REQUEST, ciphertext: '' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects unsupported message types', async () => {
    await expect(
      sendGroupMessageDirectTyped(
        { ...SEND_MESSAGE_REQUEST, messageType: 'commit' },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects send when caller is not a group member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      sendGroupMessageDirectTyped(SEND_MESSAGE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it('rejects send when group is missing', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    await expect(
      sendGroupMessageDirectTyped(SEND_MESSAGE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.NotFound });
  });

  it('rejects send when epoch mismatches current group epoch', async () => {
    const clientQueryMock = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ current_epoch: 1 }] })
      .mockResolvedValueOnce({});

    getPostgresPoolMock.mockResolvedValue({
      query: queryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn()
      })
    });

    await expect(
      sendGroupMessageDirectTyped(SEND_MESSAGE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.AlreadyExists });
  });

  it('maps send failures to internal', async () => {
    getPostgresPoolMock.mockRejectedValueOnce(new Error('db failed'));

    await expect(
      sendGroupMessageDirectTyped(SEND_MESSAGE_REQUEST, {
        requestHeader: new Headers()
      })
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it('rejects invalid cursors when listing messages', async () => {
    await expect(
      getGroupMessagesDirectTyped(
        { groupId: 'group-1', cursor: 'abc', limit: 20 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it('rejects getGroupMessages when caller is not a member', async () => {
    getActiveMlsGroupMembershipMock.mockResolvedValueOnce(null);

    await expect(
      getGroupMessagesDirectTyped(
        { groupId: 'group-1', cursor: '', limit: 20 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
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
          sequence_number: 2,
          created_at: new Date('2026-03-03T03:14:00.000Z'),
          sender_email: null
        }
      ]
    });

    const response = await getGroupMessagesDirectTyped(
      { groupId: 'group-1', cursor: '', limit: 1 },
      { requestHeader: new Headers() }
    );

    expect(requireMlsClaimsMock).toHaveBeenCalledWith(
      '/mls/groups/group-1/messages',
      expect.any(Headers)
    );

    const listQuery = queryMock.mock.calls[0]?.[0];
    expect(typeof listQuery).toBe('string');
    if (typeof listQuery !== 'string') {
      throw new Error('Expected list query to run');
    }
    expect(listQuery).toContain("ops.source_table = 'mls_message'");
    expect(listQuery).not.toContain(
      "ops.source_table IN ('mls_messages', 'mls_message')"
    );

    expect(response).toEqual({
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

  it('defaults content type when source encoding is missing', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'message-1',
          group_id: 'group-1',
          sender_user_id: 'user-1',
          epoch: 2,
          ciphertext: 'cipher-1',
          encoded_content_type: null,
          sequence_number: 1,
          created_at: new Date('2026-03-03T03:13:00.000Z'),
          sender_email: null
        }
      ]
    });

    const response = await getGroupMessagesDirectTyped(
      { groupId: 'group-1', cursor: '', limit: 20 },
      { requestHeader: new Headers() }
    );

    expect(response).toEqual({
      messages: [
        {
          id: 'message-1',
          groupId: 'group-1',
          senderUserId: 'user-1',
          epoch: 2,
          ciphertext: 'cipher-1',
          messageType: 'application',
          contentType: 'text/plain',
          sequenceNumber: 1,
          sentAt: '2026-03-03T03:13:00.000Z',
          createdAt: '2026-03-03T03:13:00.000Z'
        }
      ],
      hasMore: false
    });
  });

  it('maps getGroupMessages failures to internal', async () => {
    queryMock.mockRejectedValueOnce(new Error('query failed'));

    await expect(
      getGroupMessagesDirectTyped(
        { groupId: 'group-1', cursor: '', limit: 20 },
        { requestHeader: new Headers() }
      )
    ).rejects.toMatchObject({ code: Code.Internal });
  });
});
