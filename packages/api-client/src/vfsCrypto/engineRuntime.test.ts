import { describe, expect, it, vi } from 'vitest';
import { createVfsCryptoEngine } from './engineRuntime';
import type { EncryptedChunk, EncryptedManifest } from './types';

function createTestKeyResolver() {
  const keys = new Map<string, Uint8Array>();
  return {
    setKey(itemId: string, epoch: number, key: Uint8Array): void {
      keys.set(`${itemId}:${epoch}`, key);
    },
    getItemKey: vi.fn(
      ({ itemId, keyEpoch }: { itemId: string; keyEpoch: number }) => {
        const key = keys.get(`${itemId}:${keyEpoch}`);
        if (!key) {
          throw new Error(`Key not found for ${itemId}:${keyEpoch}`);
        }
        return key;
      }
    )
  };
}

function generateTestKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('VfsCryptoEngine', () => {
  describe('encryptChunk', () => {
    it('encrypts chunk with correct metadata', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const plaintext = new TextEncoder().encode('hello world');

      const result = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext,
        keyEpoch: 1,
        contentType: 'text/plain'
      });

      expect(result.chunkIndex).toBe(0);
      expect(result.isFinal).toBe(true);
      expect(result.plaintextLength).toBe(plaintext.length);
      expect(result.ciphertextLength).toBeGreaterThan(plaintext.length);
      expect(result.nonce).toBeTruthy();
      expect(result.aadHash).toBeTruthy();
      expect(result.ciphertext).toBeInstanceOf(Uint8Array);
    });

    it('produces different ciphertext for same plaintext (random nonce)', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const plaintext = new TextEncoder().encode('test data');

      const result1 = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext,
        keyEpoch: 1
      });

      const result2 = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext,
        keyEpoch: 1
      });

      expect(result1.nonce).not.toBe(result2.nonce);
      expect(result1.ciphertext).not.toEqual(result2.ciphertext);
    });

    it('uses correct key epoch from resolver', async () => {
      const keyResolver = createTestKeyResolver();
      const key1 = generateTestKey();
      const key2 = generateTestKey();
      keyResolver.setKey('item-1', 1, key1);
      keyResolver.setKey('item-1', 2, key2);

      const engine = createVfsCryptoEngine({ keyResolver });
      const plaintext = new TextEncoder().encode('data');

      await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext,
        keyEpoch: 2
      });

      expect(keyResolver.getItemKey).toHaveBeenCalledWith({
        itemId: 'item-1',
        keyEpoch: 2
      });
    });
  });

  describe('decryptChunk', () => {
    it('roundtrips encryption and decryption', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const plaintext = new TextEncoder().encode('hello world roundtrip');

      const encrypted = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 3,
        isFinal: false,
        plaintext,
        keyEpoch: 1,
        contentType: 'text/plain'
      });

      const decrypted = await engine.decryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunk: encrypted,
        keyEpoch: 1,
        contentType: 'text/plain'
      });

      expect(new TextDecoder().decode(decrypted)).toBe('hello world roundtrip');
    });

    it('fails with wrong key', async () => {
      const keyResolver = createTestKeyResolver();
      const key1 = generateTestKey();
      const key2 = generateTestKey();
      keyResolver.setKey('item-1', 1, key1);
      keyResolver.setKey('item-1', 2, key2);

      const engine = createVfsCryptoEngine({ keyResolver });
      const plaintext = new TextEncoder().encode('secret');

      const encrypted = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext,
        keyEpoch: 1
      });

      await expect(
        engine.decryptChunk({
          itemId: 'item-1',
          blobId: 'blob-1',
          chunk: encrypted,
          keyEpoch: 2
        })
      ).rejects.toThrow();
    });

    it('detects tampered AAD hash', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const plaintext = new TextEncoder().encode('integrity test');

      const encrypted = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext,
        keyEpoch: 1
      });

      const tamperedChunk: EncryptedChunk = {
        ...encrypted,
        aadHash: 'tampered-hash'
      };

      await expect(
        engine.decryptChunk({
          itemId: 'item-1',
          blobId: 'blob-1',
          chunk: tamperedChunk,
          keyEpoch: 1
        })
      ).rejects.toThrow('AAD verification failed');
    });

    it('handles empty plaintext', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const plaintext = new Uint8Array(0);

      const encrypted = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: true,
        plaintext,
        keyEpoch: 1
      });

      expect(encrypted.plaintextLength).toBe(0);

      const decrypted = await engine.decryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunk: encrypted,
        keyEpoch: 1
      });

      expect(decrypted.length).toBe(0);
    });
  });

  describe('signManifest', () => {
    it('produces deterministic signature for same manifest', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const manifest = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        contentType: 'application/octet-stream',
        totalPlaintextBytes: 1024,
        totalCiphertextBytes: 1040,
        chunkCount: 1,
        chunkHashes: ['hash1'],
        wrappedFileKeys: []
      };

      const sig1 = await engine.signManifest(manifest);
      const sig2 = await engine.signManifest(manifest);

      expect(sig1).toBe(sig2);
    });

    it('produces different signature for different manifests', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const baseManifest = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        totalPlaintextBytes: 1024,
        totalCiphertextBytes: 1040,
        chunkCount: 1,
        chunkHashes: ['hash1'],
        wrappedFileKeys: []
      };

      const sig1 = await engine.signManifest(baseManifest);
      const sig2 = await engine.signManifest({
        ...baseManifest,
        totalPlaintextBytes: 2048
      });

      expect(sig1).not.toBe(sig2);
    });

    it('produces different signature for different keys', async () => {
      const keyResolver = createTestKeyResolver();
      const key1 = generateTestKey();
      const key2 = generateTestKey();
      keyResolver.setKey('item-1', 1, key1);
      keyResolver.setKey('item-2', 1, key2);

      const engine = createVfsCryptoEngine({ keyResolver });
      const manifest1 = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        totalPlaintextBytes: 100,
        totalCiphertextBytes: 116,
        chunkCount: 1,
        chunkHashes: ['hash'],
        wrappedFileKeys: []
      };
      const manifest2 = { ...manifest1, itemId: 'item-2' };

      const sig1 = await engine.signManifest(manifest1);
      const sig2 = await engine.signManifest(manifest2);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyManifest', () => {
    it('verifies valid manifest signature', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const unsignedManifest = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        totalPlaintextBytes: 512,
        totalCiphertextBytes: 528,
        chunkCount: 1,
        chunkHashes: ['chunk-hash'],
        wrappedFileKeys: []
      };

      const signature = await engine.signManifest(unsignedManifest);
      const signedManifest: EncryptedManifest = {
        ...unsignedManifest,
        manifestSignature: signature
      };

      const isValid = await engine.verifyManifest(signedManifest);
      expect(isValid).toBe(true);
    });

    it('rejects manifest with tampered signature', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const unsignedManifest = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        totalPlaintextBytes: 256,
        totalCiphertextBytes: 272,
        chunkCount: 1,
        chunkHashes: ['hash'],
        wrappedFileKeys: []
      };

      const signedManifest: EncryptedManifest = {
        ...unsignedManifest,
        manifestSignature: 'invalid-signature'
      };

      const isValid = await engine.verifyManifest(signedManifest);
      expect(isValid).toBe(false);
    });

    it('rejects manifest with modified chunk hashes', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const unsignedManifest = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        totalPlaintextBytes: 100,
        totalCiphertextBytes: 116,
        chunkCount: 2,
        chunkHashes: ['hash1', 'hash2'],
        wrappedFileKeys: []
      };

      const signature = await engine.signManifest(unsignedManifest);
      const tamperedManifest: EncryptedManifest = {
        ...unsignedManifest,
        chunkHashes: ['hash1', 'tampered-hash'],
        manifestSignature: signature
      };

      const isValid = await engine.verifyManifest(tamperedManifest);
      expect(isValid).toBe(false);
    });

    it('rejects manifest with modified byte counts', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });
      const unsignedManifest = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        totalPlaintextBytes: 100,
        totalCiphertextBytes: 116,
        chunkCount: 1,
        chunkHashes: ['hash'],
        wrappedFileKeys: []
      };

      const signature = await engine.signManifest(unsignedManifest);
      const tamperedManifest: EncryptedManifest = {
        ...unsignedManifest,
        totalPlaintextBytes: 999,
        manifestSignature: signature
      };

      const isValid = await engine.verifyManifest(tamperedManifest);
      expect(isValid).toBe(false);
    });
  });

  describe('integration', () => {
    it('full encrypt-sign-verify-decrypt flow', async () => {
      const keyResolver = createTestKeyResolver();
      const testKey = generateTestKey();
      keyResolver.setKey('item-1', 1, testKey);

      const engine = createVfsCryptoEngine({ keyResolver });

      const chunks: EncryptedChunk[] = [];
      const plaintext1 = new TextEncoder().encode('chunk one');
      const plaintext2 = new TextEncoder().encode('chunk two');

      const encrypted1 = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 0,
        isFinal: false,
        plaintext: plaintext1,
        keyEpoch: 1
      });
      chunks.push(encrypted1);

      const encrypted2 = await engine.encryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunkIndex: 1,
        isFinal: true,
        plaintext: plaintext2,
        keyEpoch: 1
      });
      chunks.push(encrypted2);

      const chunkHashes = await Promise.all(
        chunks.map(async (c) => {
          const digest = await crypto.subtle.digest('SHA-256', c.ciphertext);
          return btoa(String.fromCharCode(...new Uint8Array(digest)));
        })
      );

      const unsignedManifest = {
        itemId: 'item-1',
        blobId: 'blob-1',
        keyEpoch: 1,
        totalPlaintextBytes: plaintext1.length + plaintext2.length,
        totalCiphertextBytes:
          encrypted1.ciphertextLength + encrypted2.ciphertextLength,
        chunkCount: 2,
        chunkHashes,
        wrappedFileKeys: []
      };

      const signature = await engine.signManifest(unsignedManifest);
      const manifest: EncryptedManifest = {
        ...unsignedManifest,
        manifestSignature: signature
      };

      const isValid = await engine.verifyManifest(manifest);
      expect(isValid).toBe(true);

      const decrypted1 = await engine.decryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunk: encrypted1,
        keyEpoch: 1
      });
      const decrypted2 = await engine.decryptChunk({
        itemId: 'item-1',
        blobId: 'blob-1',
        chunk: encrypted2,
        keyEpoch: 1
      });

      expect(new TextDecoder().decode(decrypted1)).toBe('chunk one');
      expect(new TextDecoder().decode(decrypted2)).toBe('chunk two');
    });
  });
});
