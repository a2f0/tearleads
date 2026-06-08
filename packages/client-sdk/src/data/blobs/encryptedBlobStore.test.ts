import { expect, test } from "bun:test";
import type { BlobBytes, BlobStore } from "../blobContracts";
import {
  createEncryptedOpfsBlobStore,
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
      async readBytes(storageKey) {
        const bytes = rawBytesByKey.get(storageKey);
        return bytes ? copyBytes(bytes) : null;
      },
      async writeBytes(storageKey, bytes) {
        rawBytesByKey.set(storageKey, copyBytes(bytes));
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
          pending = copyBytes(chunk);
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
  const { store: innerStore } = createInspectableBlobStore();
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

test("encrypted blob store ignores unknown envelope fields", async () => {
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
  const envelope = JSON.parse(TEXT_DECODER.decode(stored)) as Record<
    string,
    unknown
  > & {
    futureField?: unknown;
    keyDerivation?: unknown;
  };
  envelope.futureField = "future-value";
  if (
    envelope.keyDerivation &&
    typeof envelope.keyDerivation === "object" &&
    !Array.isArray(envelope.keyDerivation)
  ) {
    Reflect.set(envelope.keyDerivation, "futureField", "future-value");
  }
  rawBytesByKey.set(
    "attachment-1",
    TEXT_ENCODER.encode(JSON.stringify(envelope)),
  );

  await expect(store.readBytes("attachment-1")).resolves.toEqual(
    blobBytes("local attachment bytes"),
  );
});

test("encrypted blob store treats omitted raw-key derivation as none", async () => {
  const { rawBytesByKey, store: innerStore } = createInspectableBlobStore();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const store = wrapEncryptedBlobStore(innerStore, {
    key: rawKey,
    namespace: "identity-a",
  });
  await store.writeBytes("attachment-1", blobBytes("local attachment bytes"));

  const stored = rawBytesByKey.get("attachment-1");
  if (!stored) {
    throw new Error("Expected encrypted blob bytes.");
  }
  const envelope = JSON.parse(TEXT_DECODER.decode(stored)) as Record<
    string,
    unknown
  >;
  Reflect.deleteProperty(envelope, "keyDerivation");
  rawBytesByKey.set(
    "attachment-1",
    TEXT_ENCODER.encode(JSON.stringify(envelope)),
  );

  await expect(store.readBytes("attachment-1")).resolves.toEqual(
    blobBytes("local attachment bytes"),
  );
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
    const store = createEncryptedOpfsBlobStore("identity-a", {
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
