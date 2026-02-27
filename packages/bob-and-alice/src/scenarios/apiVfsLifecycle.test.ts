import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

describe('API VFS lifecycle', () => {
  let harness: ApiScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('Alice sets up keys, registers an item, shares with Bob, and Bob receives it', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'alice' }, { alias: 'bob' }],
      getApiDeps
    );

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    // Put Alice and Bob in a shared organization for share operations
    const sharedOrgId = 'shared-org-vfs-lifecycle';
    await harness.ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Shared Org', NOW(), NOW())`,
      [sharedOrgId]
    );
    await harness.ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW()), ($3, $2, NOW())`,
      [alice.user.userId, sharedOrgId, bob.user.userId]
    );

    // Alice sets up VFS keys
    const setupKeysResponse = await alice.fetch('/vfs/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicEncryptionKey: 'alice-public-enc-key',
        publicSigningKey: 'alice-public-sign-key',
        encryptedPrivateKeys: 'alice-encrypted-private-keys',
        argon2Salt: 'alice-argon2-salt'
      })
    });
    expect(setupKeysResponse.status).toBe(201);

    // Alice retrieves her keys
    const keysBody = await alice.fetchJson<{
      publicEncryptionKey: string;
      argon2Salt: string;
    }>('/vfs/keys/me');
    expect(keysBody.publicEncryptionKey).toBe('alice-public-enc-key');
    expect(keysBody.argon2Salt).toBe('alice-argon2-salt');

    // Alice registers a VFS item
    const registerBody = await alice.fetchJson<{
      id: string;
      createdAt: string;
    }>('/vfs/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'note-1',
        objectType: 'file',
        encryptedSessionKey: 'encrypted-session-key'
      })
    });
    expect(registerBody.id).toBe('note-1');
    expect(registerBody).toHaveProperty('createdAt');

    // Alice lists shares for the item (should be empty initially)
    const sharesEmpty = await alice.fetchJson<{
      shares: unknown[];
      orgShares: unknown[];
    }>('/vfs/items/note-1/shares');
    expect(sharesEmpty.shares).toHaveLength(0);
    expect(sharesEmpty.orgShares).toHaveLength(0);

    // Alice shares the item with Bob
    const shareResponse = await alice.fetchJson<{
      share: {
        id: string;
        itemId: string;
        targetId: string;
        permissionLevel: string;
      };
    }>('/vfs/items/note-1/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'note-1',
        shareType: 'user',
        targetId: bob.user.userId,
        permissionLevel: 'view',
        wrappedKey: {
          recipientUserId: bob.user.userId,
          recipientPublicKeyId: 'bob-pk',
          keyEpoch: 1,
          encryptedKey: 'wrapped-key-for-bob',
          senderSignature: 'alice-signature'
        }
      })
    });
    const shareBody = shareResponse.share;
    expect(shareBody.itemId).toBe('note-1');
    expect(shareBody.targetId).toBe(bob.user.userId);
    expect(shareBody.permissionLevel).toBe('view');

    // Verify shares list now has one entry
    const sharesAfter = await alice.fetchJson<{
      shares: Array<{ id: string; targetId: string }>;
    }>('/vfs/items/note-1/shares');
    expect(sharesAfter.shares).toHaveLength(1);
    expect(sharesAfter.shares[0]?.targetId).toBe(bob.user.userId);

    // Update the share permission from view to edit
    const shareUuid = shareBody.id.replace('share:', '');
    const updateResponse = await alice.fetchJson<{
      share: { id: string; permissionLevel: string };
    }>(`/vfs/shares/${shareUuid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionLevel: 'edit' })
    });
    expect(updateResponse.share.permissionLevel).toBe('edit');

    // Alice rekeys the item
    const rekeyBody = await alice.fetchJson<{
      itemId: string;
      newEpoch: number;
      wrapsApplied: number;
    }>('/vfs/items/note-1/rekey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'manual',
        newEpoch: 2,
        wrappedKeys: [
          {
            recipientUserId: bob.user.userId,
            recipientPublicKeyId: 'bob-pk',
            keyEpoch: 2,
            encryptedKey: 'rekeyed-key-for-bob',
            senderSignature: 'alice-rekey-signature'
          }
        ]
      })
    });
    expect(rekeyBody.itemId).toBe('note-1');
    expect(rekeyBody.newEpoch).toBe(2);

    // Alice deletes the share
    const deleteShareResponse = await alice.fetch(`/vfs/shares/${shareUuid}`, {
      method: 'DELETE'
    });
    expect(deleteShareResponse.status).toBe(200);

    // Verify shares list is empty again
    const sharesFinal = await alice.fetchJson<{
      shares: unknown[];
    }>('/vfs/items/note-1/shares');
    expect(sharesFinal.shares).toHaveLength(0);
  });

  it('creates an org-share between two organizations', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'alice' }, { alias: 'bob' }],
      getApiDeps
    );

    const alice = harness.actor('alice');

    // Create source and target organizations
    const sourceOrgId = 'source-org-lifecycle';
    const targetOrgId = 'target-org-lifecycle';
    await harness.ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Source Org', NOW(), NOW()), ($2, 'Target Org', NOW(), NOW())`,
      [sourceOrgId, targetOrgId]
    );
    await harness.ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [alice.user.userId, sourceOrgId]
    );

    // Setup keys and register item
    await alice.fetch('/vfs/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicEncryptionKey: 'alice-enc-key',
        publicSigningKey: 'alice-sign-key',
        encryptedPrivateKeys: 'alice-enc-privkeys',
        argon2Salt: 'alice-salt'
      })
    });
    await alice.fetchJson('/vfs/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'org-shared-item',
        objectType: 'file',
        encryptedSessionKey: 'org-session-key'
      })
    });

    // Create org-share
    const orgShareResponse = await alice.fetchJson<{
      orgShare: {
        id: string;
        sourceOrgId: string;
        targetOrgId: string;
        permissionLevel: string;
      };
    }>('/vfs/items/org-shared-item/org-shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'org-shared-item',
        sourceOrgId,
        targetOrgId,
        permissionLevel: 'view'
      })
    });
    const orgShareBody = orgShareResponse.orgShare;
    expect(orgShareBody.sourceOrgId).toBe(sourceOrgId);
    expect(orgShareBody.targetOrgId).toBe(targetOrgId);
    expect(orgShareBody.permissionLevel).toBe('view');

    // Delete org-share
    const orgShareParts = orgShareBody.id.split(':');
    const orgShareUuid = orgShareParts[orgShareParts.length - 1];
    expect(orgShareUuid).toBeTruthy();
    const deleteResponse = await alice.fetch(
      `/vfs/org-shares/${orgShareUuid}`,
      { method: 'DELETE' }
    );
    expect(deleteResponse.status).toBe(200);
  });

  it('records and queries AI usage', async () => {
    harness = await ApiScenarioHarness.create([{ alias: 'alice' }], getApiDeps);
    const alice = harness.actor('alice');

    // Record usage
    const usageBody = await alice.fetchJson<{
      usage: { modelId: string; totalTokens: number };
    }>('/ai/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: 'mistralai/mistral-7b-instruct',
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80
      })
    });
    expect(usageBody.usage.modelId).toBe('mistralai/mistral-7b-instruct');
    expect(usageBody.usage.totalTokens).toBe(80);

    // Query usage summary
    const summaryBody = await alice.fetchJson<{
      summary: { totalTokens: number; requestCount: number };
    }>('/ai/usage/summary');
    expect(summaryBody.summary.totalTokens).toBe(80);
    expect(summaryBody.summary.requestCount).toBe(1);

    // Query usage list
    const listBody = await alice.fetchJson<{
      usage: Array<{ modelId: string }>;
      hasMore: boolean;
    }>('/ai/usage');
    expect(listBody.usage).toHaveLength(1);
    expect(listBody.usage[0]?.modelId).toBe('mistralai/mistral-7b-instruct');
    expect(listBody.hasMore).toBe(false);
  });

  it('handles blob stage/chunk/attach lifecycle transitions', async () => {
    const hostItemId = 'blob-host-item';
    const hostItemSessionKey = 'host-item-session-key';
    const stageOneId = 'blob-stage-1';
    const blobOneId = 'blob-object-1';
    const uploadOneId = 'upload-1';
    const stageTwoId = 'blob-stage-2';
    const blobTwoId = 'blob-object-2';

    harness = await ApiScenarioHarness.create([{ alias: 'alice' }], getApiDeps);
    const alice = harness.actor('alice');

    await alice.fetchJson('/vfs/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: hostItemId,
        objectType: 'file',
        encryptedSessionKey: hostItemSessionKey
      })
    });

    const stageResponse = await alice.fetchJson<{
      stagingId: string;
      blobId: string;
      status: string;
      stagedAt: string;
      expiresAt: string;
    }>('/vfs/blobs/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stagingId: stageOneId,
        blobId: blobOneId,
        expiresAt: '2099-01-01T00:00:00.000Z'
      })
    });
    expect(stageResponse.stagingId).toBe(stageOneId);
    expect(stageResponse.blobId).toBe(blobOneId);
    expect(stageResponse.status).toBe('staged');

    const chunkResponse = await alice.fetchJson<{
      accepted: boolean;
      stagingId: string;
      uploadId: string;
      chunkIndex: number;
    }>(`/vfs/blobs/stage/${stageOneId}/chunks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: uploadOneId,
        chunkIndex: 0,
        isFinal: true,
        nonce: 'nonce-1',
        aadHash: 'aad-1',
        ciphertextBase64: Buffer.from('blob-chunk-1').toString('base64'),
        plaintextLength: 12,
        ciphertextLength: 12
      })
    });
    expect(chunkResponse.accepted).toBe(true);
    expect(chunkResponse.stagingId).toBe(stageOneId);
    expect(chunkResponse.uploadId).toBe(uploadOneId);

    const attachResponse = await alice.fetchJson<{
      attached: boolean;
      stagingId: string;
      blobId: string;
      itemId: string;
      relationKind: string;
      refId: string;
      attachedAt: string;
    }>(`/vfs/blobs/stage/${stageOneId}/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: hostItemId,
        relationKind: 'file'
      })
    });
    expect(attachResponse.attached).toBe(true);
    expect(attachResponse.blobId).toBe(blobOneId);
    expect(attachResponse.itemId).toBe(hostItemId);
    expect(attachResponse.relationKind).toBe('file');

    const abandonAfterAttach = await alice.fetch(
      `/vfs/blobs/stage/${stageOneId}/abandon`,
      { method: 'POST' }
    );
    expect(abandonAfterAttach.status).toBe(409);
    expect(await abandonAfterAttach.json()).toEqual({
      error: 'Blob staging is no longer abandonable'
    });

    const deleteAttachedBlob = await alice.fetch(`/vfs/blobs/${blobOneId}`, {
      method: 'DELETE'
    });
    expect(deleteAttachedBlob.status).toBe(409);
    expect(await deleteAttachedBlob.json()).toEqual({
      error: 'Blob is attached and cannot be deleted'
    });

    await alice.fetchJson('/vfs/blobs/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stagingId: stageTwoId,
        blobId: blobTwoId,
        expiresAt: '2099-01-02T00:00:00.000Z'
      })
    });

    const abandonResponse = await alice.fetchJson<{
      abandoned: boolean;
      stagingId: string;
      status: string;
    }>(`/vfs/blobs/stage/${stageTwoId}/abandon`, {
      method: 'POST'
    });
    expect(abandonResponse.abandoned).toBe(true);
    expect(abandonResponse.stagingId).toBe(stageTwoId);
    expect(abandonResponse.status).toBe('abandoned');

    const attachAfterAbandon = await alice.fetch(
      `/vfs/blobs/stage/${stageTwoId}/attach`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: hostItemId,
          relationKind: 'file'
        })
      }
    );
    expect(attachAfterAbandon.status).toBe(409);
    expect(await attachAfterAbandon.json()).toEqual({
      error: 'Blob staging is no longer attachable'
    });
  });
});
