import { describe, expect, it } from 'vitest';
import {
  combineEncapsulation,
  combinePublicKey,
  decryptWithKeyPair,
  deserializeKeyPair,
  deserializePublicKey,
  encryptForRecipient,
  extractPublicKey,
  generateKeyPair,
  serializeKeyPair,
  serializePublicKey,
  splitEncapsulation,
  splitPublicKey,
  unwrapKeyWithKeyPair,
  wrapKeyForRecipient
} from './asymmetric.js';

describe('VFS Asymmetric Crypto', () => {
  describe('Key Generation', () => {
    it('should generate a valid keypair', () => {
      const keyPair = generateKeyPair();

      // X25519 keys should be 32 bytes
      expect(keyPair.x25519PublicKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.x25519PublicKey.length).toBe(32);
      expect(keyPair.x25519PrivateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.x25519PrivateKey.length).toBe(32);

      // ML-KEM-768 keys have specific sizes
      expect(keyPair.mlKemPublicKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.mlKemPublicKey.length).toBe(1184); // ML-KEM-768 public key
      expect(keyPair.mlKemPrivateKey).toBeInstanceOf(Uint8Array);
      expect(keyPair.mlKemPrivateKey.length).toBe(2400); // ML-KEM-768 private key
    });

    it('should generate unique keypairs', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();

      // Keys should be different
      expect(keyPair1.x25519PublicKey).not.toEqual(keyPair2.x25519PublicKey);
      expect(keyPair1.mlKemPublicKey).not.toEqual(keyPair2.mlKemPublicKey);
    });
  });

  describe('Public Key Extraction', () => {
    it('should extract only public keys', () => {
      const keyPair = generateKeyPair();
      const publicKey = extractPublicKey(keyPair);

      expect(publicKey.x25519PublicKey).toEqual(keyPair.x25519PublicKey);
      expect(publicKey.mlKemPublicKey).toEqual(keyPair.mlKemPublicKey);
      expect(publicKey).not.toHaveProperty('x25519PrivateKey');
      expect(publicKey).not.toHaveProperty('mlKemPrivateKey');
    });
  });

  describe('Encryption/Decryption', () => {
    it('should encrypt and decrypt data', () => {
      const recipientKeyPair = generateKeyPair();
      const recipientPublicKey = extractPublicKey(recipientKeyPair);

      const plaintext = new TextEncoder().encode('Hello, VFS!');
      const encapsulation = encryptForRecipient(plaintext, recipientPublicKey);

      // Verify encapsulation structure
      expect(encapsulation.x25519EphemeralPublic).toBeInstanceOf(Uint8Array);
      expect(encapsulation.x25519EphemeralPublic.length).toBe(32);
      expect(encapsulation.mlKemCiphertext).toBeInstanceOf(Uint8Array);
      expect(encapsulation.mlKemCiphertext.length).toBe(1088); // ML-KEM-768 ciphertext
      expect(encapsulation.nonce).toBeInstanceOf(Uint8Array);
      expect(encapsulation.nonce.length).toBe(12);
      expect(encapsulation.ciphertext).toBeInstanceOf(Uint8Array);

      // Decrypt and verify
      const decrypted = decryptWithKeyPair(encapsulation, recipientKeyPair);
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, VFS!');
    });

    it('should fail decryption with wrong key', () => {
      const recipientKeyPair = generateKeyPair();
      const wrongKeyPair = generateKeyPair();
      const recipientPublicKey = extractPublicKey(recipientKeyPair);

      const plaintext = new TextEncoder().encode('Secret message');
      const encapsulation = encryptForRecipient(plaintext, recipientPublicKey);

      // Should throw when decrypting with wrong key
      expect(() => decryptWithKeyPair(encapsulation, wrongKeyPair)).toThrow();
    });

    it('should handle empty data', () => {
      const recipientKeyPair = generateKeyPair();
      const recipientPublicKey = extractPublicKey(recipientKeyPair);

      const plaintext = new Uint8Array(0);
      const encapsulation = encryptForRecipient(plaintext, recipientPublicKey);
      const decrypted = decryptWithKeyPair(encapsulation, recipientKeyPair);

      expect(decrypted.length).toBe(0);
    });

    it('should handle large data', () => {
      const recipientKeyPair = generateKeyPair();
      const recipientPublicKey = extractPublicKey(recipientKeyPair);

      // 100KB of random data (crypto.getRandomValues has a 64KB limit per call)
      const plaintext = new Uint8Array(100 * 1024);
      // Fill in chunks of 64KB
      for (let i = 0; i < plaintext.length; i += 65536) {
        const chunk = plaintext.subarray(
          i,
          Math.min(i + 65536, plaintext.length)
        );
        crypto.getRandomValues(chunk);
      }

      const encapsulation = encryptForRecipient(plaintext, recipientPublicKey);
      const decrypted = decryptWithKeyPair(encapsulation, recipientKeyPair);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('Key Wrapping', () => {
    it('should wrap and unwrap a session key', () => {
      const recipientKeyPair = generateKeyPair();
      const recipientPublicKey = extractPublicKey(recipientKeyPair);

      // Simulate a 256-bit AES session key
      const sessionKey = new Uint8Array(32);
      crypto.getRandomValues(sessionKey);

      const wrapped = wrapKeyForRecipient(sessionKey, recipientPublicKey);
      const unwrapped = unwrapKeyWithKeyPair(wrapped, recipientKeyPair);

      expect(unwrapped).toEqual(sessionKey);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize keypair', () => {
      const keyPair = generateKeyPair();
      const serialized = serializeKeyPair(keyPair);

      expect(typeof serialized.x25519PublicKey).toBe('string');
      expect(typeof serialized.x25519PrivateKey).toBe('string');
      expect(typeof serialized.mlKemPublicKey).toBe('string');
      expect(typeof serialized.mlKemPrivateKey).toBe('string');

      const deserialized = deserializeKeyPair(serialized);
      expect(deserialized.x25519PublicKey).toEqual(keyPair.x25519PublicKey);
      expect(deserialized.x25519PrivateKey).toEqual(keyPair.x25519PrivateKey);
      expect(deserialized.mlKemPublicKey).toEqual(keyPair.mlKemPublicKey);
      expect(deserialized.mlKemPrivateKey).toEqual(keyPair.mlKemPrivateKey);
    });

    it('should serialize and deserialize public key', () => {
      const keyPair = generateKeyPair();
      const publicKey = extractPublicKey(keyPair);
      const serialized = serializePublicKey(publicKey);

      expect(typeof serialized.x25519PublicKey).toBe('string');
      expect(typeof serialized.mlKemPublicKey).toBe('string');

      const deserialized = deserializePublicKey(serialized);
      expect(deserialized.x25519PublicKey).toEqual(publicKey.x25519PublicKey);
      expect(deserialized.mlKemPublicKey).toEqual(publicKey.mlKemPublicKey);
    });

    it('should combine and split public key', () => {
      const keyPair = generateKeyPair();
      const publicKey = extractPublicKey(keyPair);
      const serialized = serializePublicKey(publicKey);

      const combined = combinePublicKey(serialized);
      expect(typeof combined).toBe('string');
      expect(combined).toContain('.');

      const split = splitPublicKey(combined);
      expect(split).toEqual(serialized);
    });

    it('should combine and split encapsulation', () => {
      const recipientKeyPair = generateKeyPair();
      const recipientPublicKey = extractPublicKey(recipientKeyPair);
      const sessionKey = new Uint8Array(32);
      crypto.getRandomValues(sessionKey);

      const wrapped = wrapKeyForRecipient(sessionKey, recipientPublicKey);
      const combined = combineEncapsulation(wrapped);

      expect(typeof combined).toBe('string');
      expect(combined.split('.').length).toBe(4);

      const split = splitEncapsulation(combined);
      expect(split).toEqual(wrapped);

      // Verify the split can still be used for unwrapping
      const unwrapped = unwrapKeyWithKeyPair(split, recipientKeyPair);
      expect(unwrapped).toEqual(sessionKey);
    });
  });

  describe('End-to-End VFS Sharing Flow', () => {
    it('should simulate sharing an item with another user', () => {
      // User A creates an item with a session key
      // (User A's keypair would be used to access their own items, but we focus on sharing here)
      const itemSessionKey = new Uint8Array(32);
      crypto.getRandomValues(itemSessionKey);

      // User B wants to receive access
      const userBKeyPair = generateKeyPair();
      const userBPublicKey = extractPublicKey(userBKeyPair);

      // User A wraps the session key for User B
      const wrappedForB = wrapKeyForRecipient(itemSessionKey, userBPublicKey);

      // User B unwraps the session key
      const unwrappedByB = unwrapKeyWithKeyPair(wrappedForB, userBKeyPair);

      // User B now has the same session key
      expect(unwrappedByB).toEqual(itemSessionKey);

      // Both can now use the session key to encrypt/decrypt item content
      // (using the symmetric crypto from web-crypto.ts)
    });

    it('should simulate hierarchical key sharing (folder contains items)', () => {
      // User A has a folder with a hierarchical keypair
      const folderKeyPair = generateKeyPair();
      const folderSessionKey = new Uint8Array(32);
      crypto.getRandomValues(folderSessionKey);

      // Item inside the folder has its own session key
      const itemSessionKey = new Uint8Array(32);
      crypto.getRandomValues(itemSessionKey);

      // The item's key is wrapped with the folder's public hierarchical key
      const folderPublicKey = extractPublicKey(folderKeyPair);
      const itemKeyWrappedForFolder = wrapKeyForRecipient(
        itemSessionKey,
        folderPublicKey
      );

      // User B gets access to the folder
      const userBKeyPair = generateKeyPair();
      const userBPublicKey = extractPublicKey(userBKeyPair);

      // User A wraps the folder's session key AND hierarchical private key for User B
      const folderSessionWrapped = wrapKeyForRecipient(
        folderSessionKey,
        userBPublicKey
      );

      // Serialize and wrap the folder's hierarchical private key
      const serializedFolderKeyPair = serializeKeyPair(folderKeyPair);
      const folderPrivateKeysJson = JSON.stringify({
        x25519PrivateKey: serializedFolderKeyPair.x25519PrivateKey,
        mlKemPrivateKey: serializedFolderKeyPair.mlKemPrivateKey
      });
      const folderHierarchicalWrapped = wrapKeyForRecipient(
        new TextEncoder().encode(folderPrivateKeysJson),
        userBPublicKey
      );

      // User B unwraps the folder's keys
      const unwrappedFolderSession = unwrapKeyWithKeyPair(
        folderSessionWrapped,
        userBKeyPair
      );
      expect(unwrappedFolderSession).toEqual(folderSessionKey);

      const unwrappedFolderPrivateJson = new TextDecoder().decode(
        unwrapKeyWithKeyPair(folderHierarchicalWrapped, userBKeyPair)
      );
      const unwrappedFolderPrivate = JSON.parse(unwrappedFolderPrivateJson);

      // User B reconstructs the folder's keypair (with the private keys)
      const reconstructedFolderKeyPair = deserializeKeyPair({
        x25519PublicKey: serializedFolderKeyPair.x25519PublicKey,
        x25519PrivateKey: unwrappedFolderPrivate.x25519PrivateKey,
        mlKemPublicKey: serializedFolderKeyPair.mlKemPublicKey,
        mlKemPrivateKey: unwrappedFolderPrivate.mlKemPrivateKey
      });

      // User B can now unwrap the item's key using the folder's keypair
      const unwrappedItemKey = unwrapKeyWithKeyPair(
        itemKeyWrappedForFolder,
        reconstructedFolderKeyPair
      );
      expect(unwrappedItemKey).toEqual(itemSessionKey);
    });
  });
});
