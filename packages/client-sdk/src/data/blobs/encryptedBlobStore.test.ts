import { expect, test } from "bun:test";
import {
  type BlobByteSource,
  type BlobBytes,
  type BlobStore,
  createBlobByteSource,
  readBlobByteSource,
} from "../blobContracts";
import { ENCRYPTED_BLOB_CHUNK_SIZE } from "./encryptedBlobEnvelope";
import {
  createEncryptedBlobStore,
  createLazyEncryptedBlobStore,
  wrapEncryptedBlobStore,
} from "./encryptedBlobStore";

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function blobBytes(value: string): BlobBytes {
  return TEXT_ENCODER.encode(value);
}

function copyBytes(bytes: Uint8Array): BlobBytes {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function createInspectableBlobStore(): {
  rawBytesByKey: Map<string, BlobBytes>;
  store: BlobStore;
} {
  const rawBytesByKey = new Map<string, BlobBytes>();

  return {
    rawBytesByKey,
    store: {
      async deleteBytes(storageKey) {
        rawBytesByKey.delete(storageKey);
      },
      async openByteSource(storageKey) {
        const bytes = rawBytesByKey.get(storageKey);
        return bytes ? createBlobByteSource(copyBytes(bytes)) : null;
      },
      async readBytes(storageKey) {
        const source = await this.openByteSource(storageKey);
        return source ? readBlobByteSource(source) : null;
      },
      async writeByteSource(storageKey, source) {
        rawBytesByKey.set(storageKey, await readBlobByteSource(source));
      },
      async writeBytes(storageKey, bytes) {
        await this.writeByteSource(storageKey, createBlobByteSource(bytes));
      },
    },
  };
}

class FakeFileHandle {
  constructor(
    private readonly directory: FakeDirectoryHandle,
    private readonly name: string,
  ) {}

  async getFile(): Promise<File> {
    const bytes = this.directory.files.get(this.name);
    if (!bytes) {
      throw new DOMException("File not found", "NotFoundError");
    }

    return new Blob([bytes]) as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const directory = this.directory;
    const name = this.name;
    let pending = new Uint8Array();

    return {
      async write(chunk: FileSystemWriteChunkType) {
        if (chunk instanceof Uint8Array) {
          const next = new Uint8Array(pending.byteLength + chunk.byteLength);
          next.set(pending);
          next.set(chunk, pending.byteLength);
          pending = next;
          return;
        }
        if (chunk instanceof Blob) {
          pending = new Uint8Array(await chunk.arrayBuffer());
          return;
        }
        if (typeof chunk === "string") {
          pending = TEXT_ENCODER.encode(chunk);
          return;
        }
        if (chunk instanceof ArrayBuffer) {
          pending = new Uint8Array(chunk.slice(0));
          return;
        }

        throw new Error("Unsupported fake OPFS write chunk.");
      },
      async close() {
        directory.files.set(name, copyBytes(pending));
      },
      async abort() {
        pending = new Uint8Array();
      },
    } as FileSystemWritableFileStream;
  }
}

class FakeDirectoryHandle {
  readonly directories = new Map<string, FakeDirectoryHandle>();
  readonly files = new Map<string, BlobBytes>();

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) {
      return existing as unknown as FileSystemDirectoryHandle;
    }
    if (!options?.create) {
      throw new DOMException("Directory not found", "NotFoundError");
    }

    const directory = new FakeDirectoryHandle();
    this.directories.set(name, directory);
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle> {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException("File not found", "NotFoundError");
    }

    return new FakeFileHandle(this, name) as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) {
      throw new DOMException("File not found", "NotFoundError");
    }
  }
}

async function withFakeOpfs<T>(
  operation: (rootDirectory: FakeDirectoryHandle) => Promise<T>,
): Promise<T> {
  const rootDirectory = new FakeDirectoryHandle();
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      storage: {
        getDirectory: async () =>
          rootDirectory as unknown as FileSystemDirectoryHandle,
      },
    },
  });

  try {
    return await operation(rootDirectory);
  } finally {
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  }
}

test("encrypted blob store encrypts stored bytes and decrypts with the same key", async () => {
  const { rawBytesByKey, store: innerStore } = createInspectableBlobStore();
  const store = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });

  await store.writeBytes("attachment-1", blobBytes("local attachment bytes"));

  const stored = rawBytesByKey.get("attachment-1");
  if (!stored) {
    throw new Error("Expected encrypted blob bytes.");
  }
  expect(stored).not.toEqual(blobBytes("local attachment bytes"));
  const storedEnvelope = TEXT_DECODER.decode(stored);
  expect(storedEnvelope).toContain("tearleads.local-blob-store.encrypted");
  expect(storedEnvelope).not.toContain("local attachment bytes");
  await expect(store.readBytes("attachment-1")).resolves.toEqual(
    blobBytes("local attachment bytes"),
  );
});

test("encrypted blob store authenticates the key and namespace", async () => {
  const { rawBytesByKey, store: innerStore } = createInspectableBlobStore();
  const store = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  await store.writeBytes("attachment-1", blobBytes("local attachment bytes"));

  const wrongKeyStore = wrapEncryptedBlobStore(innerStore, {
    key: "wrong-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  await expect(wrongKeyStore.readBytes("attachment-1")).rejects.toThrow(
    "could not be decrypted",
  );

  const wrongNamespaceStore = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-b",
  });
  await expect(wrongNamespaceStore.readBytes("attachment-1")).rejects.toThrow(
    "could not be decrypted",
  );

  const stored = rawBytesByKey.get("attachment-1");
  if (!stored) {
    throw new Error("Expected encrypted blob bytes.");
  }
  rawBytesByKey.set("attachment-2", stored);
  await expect(store.readBytes("attachment-2")).rejects.toThrow(
    "could not be decrypted",
  );
});

test("encrypted blob store retries key derivation after a transient failure", async () => {
  const { store: innerStore } = createInspectableBlobStore();
  const writerStore = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  await writerStore.writeBytes(
    "attachment-1",
    blobBytes("local attachment bytes"),
  );

  const readerStore = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  const passphraseMaterialDescriptor = Object.getOwnPropertyDescriptor(
    readerStore,
    "passphraseMaterialPromise",
  );
  if (!passphraseMaterialDescriptor) {
    throw new Error("Expected encrypted blob store passphrase material.");
  }

  Object.defineProperty(readerStore, "passphraseMaterialPromise", {
    ...passphraseMaterialDescriptor,
    value: Promise.reject(new Error("forced key derivation failure")),
  });

  await expect(readerStore.readBytes("attachment-1")).rejects.toThrow(
    "forced key derivation failure",
  );
  Object.defineProperty(
    readerStore,
    "passphraseMaterialPromise",
    passphraseMaterialDescriptor,
  );
  await expect(readerStore.readBytes("attachment-1")).resolves.toEqual(
    blobBytes("local attachment bytes"),
  );
});

test("lazy encrypted blob store defers key loading until first operation", async () => {
  await withFakeOpfs(async () => {
    let keyProviderCalls = 0;
    const store = createLazyEncryptedBlobStore("identity-a", async () => {
      keyProviderCalls += 1;
      return "test-key";
    });

    expect(keyProviderCalls).toBe(0);

    await store.writeBytes("attachment-1", blobBytes("local attachment bytes"));
    await expect(store.readBytes("attachment-1")).resolves.toEqual(
      blobBytes("local attachment bytes"),
    );
    expect(keyProviderCalls).toBe(1);
  });
});

test("lazy encrypted blob store retries after key provider failure", async () => {
  await withFakeOpfs(async () => {
    let keyProviderCalls = 0;
    const store = createLazyEncryptedBlobStore("identity-a", async () => {
      keyProviderCalls += 1;
      if (keyProviderCalls === 1) {
        throw new Error("temporary key provider failure");
      }

      return "test-key";
    });

    await expect(
      store.writeBytes("attachment-1", blobBytes("bytes")),
    ).rejects.toThrow("temporary key provider failure");
    await store.writeBytes("attachment-1", blobBytes("local attachment bytes"));
    await expect(store.readBytes("attachment-1")).resolves.toEqual(
      blobBytes("local attachment bytes"),
    );
    expect(keyProviderCalls).toBe(2);
  });
});

test("encrypted blob store rejects the removed version-one JSON format", async () => {
  const { rawBytesByKey, store: innerStore } = createInspectableBlobStore();
  const store = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  rawBytesByKey.set(
    "attachment-1",
    TEXT_ENCODER.encode(
      JSON.stringify({
        cipher: "aes-256-gcm",
        ciphertext: "AA==",
        format: "tearleads.local-blob-store.encrypted",
        iv: "AAAAAAAAAAAAAAAA",
        keyDerivation: null,
        version: 1,
      }),
    ),
  );

  await expect(store.readBytes("attachment-1")).rejects.toThrow(
    "payload format is invalid",
  );
});

test("encrypted blob store supports raw AES keys", async () => {
  const { store: innerStore } = createInspectableBlobStore();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const store = wrapEncryptedBlobStore(innerStore, {
    key: rawKey,
    namespace: "identity-a",
  });
  await store.writeBytes("attachment-1", blobBytes("local attachment bytes"));

  await expect(store.readBytes("attachment-1")).resolves.toEqual(
    blobBytes("local attachment bytes"),
  );
});

test("encrypted blob store authenticates empty payloads", async () => {
  const { store: innerStore } = createInspectableBlobStore();
  const store = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  await store.writeBytes("empty", new Uint8Array());
  await expect(store.readBytes("empty")).resolves.toEqual(new Uint8Array());

  const wrongKeyStore = wrapEncryptedBlobStore(innerStore, {
    key: "wrong-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  await expect(wrongKeyStore.readBytes("empty")).rejects.toThrow(
    "could not be decrypted",
  );
});

test("encrypted blob store consumes and decrypts bounded multi-chunk ranges", async () => {
  const { store: innerStore } = createInspectableBlobStore();
  const store = wrapEncryptedBlobStore(innerStore, {
    key: "test-key",
    kdfIterations: 1,
    namespace: "identity-a",
  });
  const byteLength = ENCRYPTED_BLOB_CHUNK_SIZE + 137;
  const reads: Array<{ byteLength: number; offset: number }> = [];
  const plaintextSource: BlobByteSource = {
    byteLength,
    async read(offset, requestedByteLength) {
      reads.push({ byteLength: requestedByteLength, offset });
      const bytes = new Uint8Array(requestedByteLength);
      for (let index = 0; index < bytes.byteLength; index += 1) {
        bytes[index] = (offset + index) % 251;
      }
      return bytes;
    },
  };

  await store.writeByteSource("attachment-1", plaintextSource);

  expect(reads).toEqual([
    { byteLength: ENCRYPTED_BLOB_CHUNK_SIZE, offset: 0 },
    { byteLength: 137, offset: ENCRYPTED_BLOB_CHUNK_SIZE },
  ]);
  const decryptedSource = await store.openByteSource("attachment-1");
  if (!decryptedSource) {
    throw new Error("Expected decrypted blob source.");
  }
  const rangeOffset = ENCRYPTED_BLOB_CHUNK_SIZE - 19;
  const range = await decryptedSource.read(rangeOffset, 43);
  const expected = new Uint8Array(43);
  for (let index = 0; index < expected.byteLength; index += 1) {
    expected[index] = (rangeOffset + index) % 251;
  }
  expect(range).toEqual(expected);
});

test("encrypted blob store rejects missing and invalid runtime keys", () => {
  const { store: innerStore } = createInspectableBlobStore();

  expect(() =>
    wrapEncryptedBlobStore(innerStore, {
      namespace: "identity-a",
    } as unknown as Parameters<typeof wrapEncryptedBlobStore>[1]),
  ).toThrow("Encrypted blob store key is required.");
  expect(() =>
    wrapEncryptedBlobStore(innerStore, {
      key: null,
      namespace: "identity-a",
    } as unknown as Parameters<typeof wrapEncryptedBlobStore>[1]),
  ).toThrow(
    "Encrypted blob store key must be a string, Uint8Array, or CryptoKey.",
  );
});

test("encrypted OPFS blob store stores encrypted files under the namespace", async () => {
  await withFakeOpfs(async (rootDirectory) => {
    const store = createEncryptedBlobStore("identity-a", {
      key: "test-key",
      kdfIterations: 1,
    });
    const storageKey = "local-document/slot-1";

    await store.writeBytes(storageKey, blobBytes("local OPFS bytes"));

    const appDirectory = rootDirectory.directories.get("tearleads");
    const identityDirectory = appDirectory?.directories.get("identity-a");
    const stored = identityDirectory?.files.get(
      `${encodeURIComponent(storageKey)}.blob`,
    );
    if (!stored) {
      throw new Error("Expected encrypted OPFS blob bytes.");
    }
    const storedEnvelope = TEXT_DECODER.decode(stored);
    expect(storedEnvelope).toContain("tearleads.local-blob-store.encrypted");
    expect(storedEnvelope).not.toContain("local OPFS bytes");
    await expect(store.readBytes(storageKey)).resolves.toEqual(
      blobBytes("local OPFS bytes"),
    );
  });
});
