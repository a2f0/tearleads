import type {
  DecryptChunkInput,
  EncryptChunkInput,
  UnsignedEncryptedManifest,
  VfsCryptoEngine
} from './engine';
import type {
  Base64,
  EncryptedChunk,
  EncryptedManifest,
  Epoch,
  ItemId,
  VfsChunkAad
} from './types';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;
const HMAC_ALGORITHM = 'SHA-256';
const MANIFEST_SIGN_INFO = 'tearleads-vfs-manifest-v1';

/**
 * Ensures Uint8Array is typed with ArrayBuffer (not ArrayBufferLike).
 * WebCrypto APIs require BufferSource which expects ArrayBuffer, not SharedArrayBuffer.
 */
function asBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data as Uint8Array<ArrayBuffer>;
}

export interface ItemKeyResolver {
  getItemKey(input: {
    itemId: ItemId;
    keyEpoch: Epoch;
  }): Promise<Uint8Array> | Uint8Array;
}

export interface VfsCryptoEngineRuntimeOptions {
  keyResolver: ItemKeyResolver;
}

export function createVfsCryptoEngine(
  options: VfsCryptoEngineRuntimeOptions
): VfsCryptoEngine {
  return new DefaultVfsCryptoEngine(options);
}

class DefaultVfsCryptoEngine implements VfsCryptoEngine {
  private readonly keyResolver: ItemKeyResolver;

  constructor(options: VfsCryptoEngineRuntimeOptions) {
    this.keyResolver = options.keyResolver;
  }

  async encryptChunk(input: EncryptChunkInput): Promise<EncryptedChunk> {
    const keyBytes = await this.keyResolver.getItemKey({
      itemId: input.itemId,
      keyEpoch: input.keyEpoch
    });

    const cryptoKey = await importAesGcmKey(keyBytes);
    const nonce = generateNonce();
    const aad = buildChunkAad({
      itemId: input.itemId,
      blobId: input.blobId,
      chunkIndex: input.chunkIndex,
      isFinal: input.isFinal,
      logicalLength: input.plaintext.length,
      keyEpoch: input.keyEpoch,
      contentType: input.contentType
    });
    const aadBytes = new TextEncoder().encode(JSON.stringify(aad));
    const aadHash = await hashSha256Base64(aadBytes);

    const ciphertext = await encryptAesGcm(
      input.plaintext,
      cryptoKey,
      nonce,
      aadBytes
    );

    return {
      chunkIndex: input.chunkIndex,
      isFinal: input.isFinal,
      nonce: toBase64(nonce),
      ciphertext,
      aadHash,
      plaintextLength: input.plaintext.length,
      ciphertextLength: ciphertext.length
    };
  }

  async decryptChunk(input: DecryptChunkInput): Promise<Uint8Array> {
    const keyBytes = await this.keyResolver.getItemKey({
      itemId: input.itemId,
      keyEpoch: input.keyEpoch
    });

    const cryptoKey = await importAesGcmKey(keyBytes);
    const nonce = fromBase64(input.chunk.nonce);

    const aad = buildChunkAad({
      itemId: input.itemId,
      blobId: input.blobId,
      chunkIndex: input.chunk.chunkIndex,
      isFinal: input.chunk.isFinal,
      logicalLength: input.chunk.plaintextLength,
      keyEpoch: input.keyEpoch,
      contentType: input.contentType
    });
    const aadBytes = new TextEncoder().encode(JSON.stringify(aad));

    const expectedAadHash = await hashSha256Base64(aadBytes);
    if (expectedAadHash !== input.chunk.aadHash) {
      throw new Error('Chunk AAD verification failed: hash mismatch');
    }

    return decryptAesGcm(input.chunk.ciphertext, cryptoKey, nonce, aadBytes);
  }

  async signManifest(input: UnsignedEncryptedManifest): Promise<Base64> {
    const keyBytes = await this.keyResolver.getItemKey({
      itemId: input.itemId,
      keyEpoch: input.keyEpoch
    });

    const signingKey = await deriveManifestSigningKey(keyBytes);
    const manifestPayload = buildManifestSignPayload(input);
    const payloadBytes = new TextEncoder().encode(manifestPayload);

    const signature = await signHmac(payloadBytes, signingKey);
    return toBase64(new Uint8Array(signature));
  }

  async verifyManifest(manifest: EncryptedManifest): Promise<boolean> {
    try {
      const keyBytes = await this.keyResolver.getItemKey({
        itemId: manifest.itemId,
        keyEpoch: manifest.keyEpoch
      });

      const signingKey = await deriveManifestSigningKey(keyBytes);
      const { manifestSignature: _sig, ...manifestWithoutSignature } = manifest;
      const manifestPayload = buildManifestSignPayload(
        manifestWithoutSignature
      );
      const payloadBytes = new TextEncoder().encode(manifestPayload);

      return verifyHmac(
        payloadBytes,
        fromBase64(manifest.manifestSignature),
        signingKey
      );
    } catch {
      return false;
    }
  }
}

function buildChunkAad(input: VfsChunkAad): VfsChunkAad {
  return {
    itemId: input.itemId,
    blobId: input.blobId,
    chunkIndex: input.chunkIndex,
    isFinal: input.isFinal,
    logicalLength: input.logicalLength,
    keyEpoch: input.keyEpoch,
    ...(input.contentType && { contentType: input.contentType })
  };
}

function buildManifestSignPayload(manifest: UnsignedEncryptedManifest): string {
  return JSON.stringify({
    info: MANIFEST_SIGN_INFO,
    itemId: manifest.itemId,
    blobId: manifest.blobId,
    keyEpoch: manifest.keyEpoch,
    contentType: manifest.contentType ?? null,
    totalPlaintextBytes: manifest.totalPlaintextBytes,
    totalCiphertextBytes: manifest.totalCiphertextBytes,
    chunkCount: manifest.chunkCount,
    chunkHashes: manifest.chunkHashes
  });
}

async function importAesGcmKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    asBufferSource(keyBytes),
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

async function deriveManifestSigningKey(
  sessionKey: Uint8Array
): Promise<CryptoKey> {
  const infoBytes = new TextEncoder().encode(MANIFEST_SIGN_INFO);
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(sessionKey),
    'HKDF',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: infoBytes
    },
    hkdfKey,
    256
  );

  return crypto.subtle.importKey(
    'raw',
    derivedBits,
    { name: 'HMAC', hash: HMAC_ALGORITHM },
    false,
    ['sign', 'verify']
  );
}

function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

async function encryptAesGcm(
  plaintext: Uint8Array,
  key: CryptoKey,
  nonce: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(aad),
      tagLength: TAG_LENGTH
    },
    key,
    asBufferSource(plaintext)
  );
  return new Uint8Array(ciphertext);
}

async function decryptAesGcm(
  ciphertext: Uint8Array,
  key: CryptoKey,
  nonce: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(aad),
      tagLength: TAG_LENGTH
    },
    key,
    asBufferSource(ciphertext)
  );
  return new Uint8Array(plaintext);
}

async function signHmac(
  data: Uint8Array,
  key: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.sign('HMAC', key, asBufferSource(data));
}

async function verifyHmac(
  data: Uint8Array,
  signature: Uint8Array,
  key: CryptoKey
): Promise<boolean> {
  return crypto.subtle.verify(
    'HMAC',
    key,
    asBufferSource(signature),
    asBufferSource(data)
  );
}

async function hashSha256Base64(data: Uint8Array): Promise<Base64> {
  const digest = await crypto.subtle.digest('SHA-256', asBufferSource(data));
  return toBase64(new Uint8Array(digest));
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export type { VfsCryptoEngine };
