import { afterEach, expect, mock, test } from "bun:test";
import { createOpfsBlobStore, purgeOpfsBlobStore } from "./opfsBlobStore";

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const attachmentBytes = new Uint8Array([1, 2, 3]);

afterEach(() => {
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

function installStorage(
  getDirectory: () => Promise<FileSystemDirectoryHandle>,
) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { getDirectory } },
  });
}

function storageDirectories() {
  const namespace = {
    getFileHandle: async () => ({
      getFile: async () => new File([attachmentBytes], "attachment.blob"),
    }),
  };
  const getNamespace = mock(async () => namespace);
  const root = {
    getDirectoryHandle: async () => ({ getDirectoryHandle: getNamespace }),
  } as unknown as FileSystemDirectoryHandle;
  return { getNamespace, root };
}

test.each(["root", "namespace"])(
  "OPFS reads recover after a failed %s directory lookup",
  async (failureStage) => {
    const { getNamespace, root } = storageDirectories();
    const error = new DOMException("Temporary storage failure", "UnknownError");
    const getDirectory = mock(async () => root);
    if (failureStage === "root") {
      getDirectory.mockImplementationOnce(async () => {
        throw error;
      });
    } else {
      getNamespace.mockImplementationOnce(async () => {
        throw error;
      });
    }
    installStorage(getDirectory);
    const store = createOpfsBlobStore("identity");

    await expect(store.readBytes("attachment")).rejects.toBe(error);
    await expect(store.readBytes("attachment")).resolves.toEqual(
      attachmentBytes,
    );
    await expect(store.readBytes("attachment")).resolves.toEqual(
      attachmentBytes,
    );
    expect(getDirectory).toHaveBeenCalledTimes(2);
  },
);

test("concurrent OPFS readers share failure and a successful retry", async () => {
  const { root } = storageDirectories();
  const firstDirectory = Promise.withResolvers<FileSystemDirectoryHandle>();
  const getDirectory = mock(async () => root);
  getDirectory.mockImplementationOnce(() => firstDirectory.promise);
  installStorage(getDirectory);
  const store = createOpfsBlobStore("identity");

  const firstRead = store.readBytes("attachment");
  const secondRead = store.readBytes("attachment");
  const error = new DOMException("Temporary storage failure", "UnknownError");
  firstDirectory.reject(error);
  expect(await Promise.allSettled([firstRead, secondRead])).toEqual([
    { status: "rejected", reason: error },
    { status: "rejected", reason: error },
  ]);
  expect(getDirectory).toHaveBeenCalledTimes(1);

  expect(
    await Promise.all([
      store.readBytes("attachment"),
      store.readBytes("attachment"),
    ]),
  ).toEqual([attachmentBytes, attachmentBytes]);
  expect(getDirectory).toHaveBeenCalledTimes(2);
});

test("confirmed logout skips attachment removal after a new sign-in during directory lookup", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const removeEntry = mock(async () => {});
  installStorage(
    async () =>
      ({
        getDirectoryHandle: async () => {
          started.resolve();
          await release.promise;
          return { removeEntry };
        },
      }) as unknown as FileSystemDirectoryHandle,
  );
  let current = true;
  const pending = purgeOpfsBlobStore("identity", () => current);
  await started.promise;
  current = false;
  release.resolve();
  await pending;
  expect(removeEntry).not.toHaveBeenCalled();
});

test("a new attachment waits for dispatched removal and reopens the identity directory", async () => {
  const removing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writtenDirectories: number[] = [];
  let directoryId = 0;
  const app = {
    async removeEntry() {
      removing.resolve();
      await release.promise;
      ++directoryId;
    },
    async getDirectoryHandle() {
      const id = directoryId;
      return {
        getFileHandle: async () => ({
          createWritable: async () => ({
            write: async () => {
              writtenDirectories.push(id);
            },
            close: async () => {},
          }),
        }),
      };
    },
  };
  installStorage(
    async () =>
      ({
        getDirectoryHandle: async () => app,
      }) as unknown as FileSystemDirectoryHandle,
  );
  const store = createOpfsBlobStore("owner");
  await store.writeBytes("before", attachmentBytes);
  const purge = purgeOpfsBlobStore("owner");
  await removing.promise;
  const write = createOpfsBlobStore("owner").writeBytes(
    "after",
    attachmentBytes,
  );
  expect(writtenDirectories).toEqual([0]);
  release.resolve();
  await Promise.all([purge, write]);
  expect(writtenDirectories).toEqual([0, 1]);
});

test.each([false, true])(
  "retiring the last chunk preserves the destination (existing: %s)",
  async (existing) => {
    const writing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const close = mock(async () => {});
    const abort = mock(async () => {});
    const file = {
      createWritable: async () => ({
        close,
        abort,
        write: async () => {
          writing.resolve();
          await release.promise;
        },
      }),
    };
    let exists = existing;
    const directory = {
      getFileHandle: async (_name: string, options?: { create?: boolean }) => {
        if (!exists && !options?.create)
          throw new DOMException("Missing", "NotFoundError");
        exists = true;
        return file;
      },
      removeEntry: async () => {
        exists = false;
      },
    };
    const app = { getDirectoryHandle: async () => directory };
    installStorage(
      async () =>
        ({
          getDirectoryHandle: async () => app,
        }) as unknown as FileSystemDirectoryHandle,
    );
    let current = true;
    const store = createOpfsBlobStore("owner");
    const pending = store.writeBytes("attachment", attachmentBytes, () => {
      if (!current) throw new Error("ended");
    });
    await writing.promise;
    current = false;
    release.resolve();
    await expect(pending).rejects.toThrow("ended");
    expect(close).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(exists).toBe(existing);
  },
);

test("an abandoned native file lookup releases the store for a retry and logout", async () => {
  const stalled = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let calls = 0;
  const app = {
    removeEntry: mock(async () => {}),
    getDirectoryHandle: async () => ({
      getFileHandle: async () => ({
        getFile: async () => {
          if (++calls === 1) {
            entered.resolve();
            await stalled.promise;
          }
          return new File([attachmentBytes], "photo.blob");
        },
      }),
    }),
  };
  installStorage(
    async () =>
      ({
        getDirectoryHandle: async () => app,
      }) as unknown as FileSystemDirectoryHandle,
  );
  const store = createOpfsBlobStore("cancelled-open");
  const controller = new AbortController();
  const first = store.openByteSource("photo", controller.signal);
  await entered.promise;
  controller.abort();
  try {
    await expect(first).rejects.toThrow();
    expect(
      (await store.openByteSource("photo", new AbortController().signal))
        ?.byteLength,
    ).toBe(3);
    await purgeOpfsBlobStore("cancelled-open");
    expect(app.removeEntry).toHaveBeenCalledTimes(1);
  } finally {
    stalled.resolve();
  }
});
