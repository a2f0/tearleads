import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImportKey, mockEncrypt, mockDecrypt, mockFilesystem } = vi.hoisted(
  () => ({
    mockImportKey: vi.fn(),
    mockEncrypt: vi.fn(),
    mockDecrypt: vi.fn(),
    mockFilesystem: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      readFile: vi.fn(),
      deleteFile: vi.fn(),
      stat: vi.fn(),
      readdir: vi.fn()
    }
  })
);

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: mockFilesystem,
  Directory: {
    Library: 'LIBRARY'
  }
}));

vi.mock('@tearleads/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tearleads/shared')>();
  return {
    ...original,
    importKey: mockImportKey,
    encrypt: mockEncrypt,
    decrypt: mockDecrypt
  };
});

import { CapacitorStorage } from './CapacitorStorage';

const STREAM_FORMAT_MAGIC = new Uint8Array([
  0x54, 0x4c, 0x46, 0x53, 0x02, 0x0a
]);

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function buildChunkedPayload(chunks: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [STREAM_FORMAT_MAGIC];
  for (const chunk of chunks) {
    const lengthPrefix = new Uint8Array(4);
    new DataView(lengthPrefix.buffer).setUint32(0, chunk.byteLength, true);
    parts.push(lengthPrefix);
    parts.push(chunk);
  }

  let total = 0;
  for (const part of parts) {
    total += part.byteLength;
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

describe('CapacitorStorage', () => {
  const encryptionKey = new Uint8Array(32);
  const cryptoKey: CryptoKey = {
    type: 'secret',
    extractable: true,
    algorithm: { name: 'AES-GCM' },
    usages: ['encrypt', 'decrypt']
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockImportKey.mockResolvedValue(cryptoKey);
    mockEncrypt.mockImplementation(async (data: Uint8Array) => {
      const encrypted = new Uint8Array(data.byteLength + 1);
      encrypted[0] = 255;
      encrypted.set(data, 1);
      return encrypted;
    });
    mockDecrypt.mockImplementation(async (data: Uint8Array) => {
      return data.slice(1);
    });
    mockFilesystem.mkdir.mockResolvedValue(undefined);
    mockFilesystem.writeFile.mockResolvedValue({ uri: 'test-uri' });
    mockFilesystem.appendFile.mockResolvedValue(undefined);
  });

  it('stores blob data with chunked append semantics', async () => {
    const storage = new CapacitorStorage('instance-1');
    await storage.initialize(encryptionKey);

    const blob = new Blob([new Uint8Array(256 * 1024)]);
    const path = await storage.storeBlob('file-1', blob);

    expect(path).toBe('file-1.enc');
    expect(mockFilesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'tearleads-files-instance-1/file-1.enc',
        directory: 'LIBRARY'
      })
    );
    expect(mockFilesystem.appendFile).toHaveBeenCalled();
    expect(mockEncrypt).toHaveBeenCalled();
  });

  it('retrieves and decrypts chunked stream-format files', async () => {
    const storage = new CapacitorStorage('instance-1');
    await storage.initialize(encryptionKey);

    const encryptedChunks = [new Uint8Array([255, 1, 2]), new Uint8Array([255, 3])];
    const payload = buildChunkedPayload(encryptedChunks);

    mockFilesystem.readFile.mockResolvedValue({
      data: bytesToBase64(payload)
    });

    const data = await storage.retrieve('file-1.enc');

    expect(mockDecrypt).toHaveBeenCalledTimes(2);
    expect(data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps legacy retrieval format compatibility', async () => {
    const storage = new CapacitorStorage('instance-1');
    await storage.initialize(encryptionKey);

    const legacyEncrypted = new Uint8Array([255, 9, 8, 7]);
    mockFilesystem.readFile.mockResolvedValue({
      data: bytesToBase64(legacyEncrypted)
    });

    const data = await storage.retrieve('legacy.enc');

    expect(mockDecrypt).toHaveBeenCalledTimes(1);
    expect(data).toEqual(new Uint8Array([9, 8, 7]));
  });
});
