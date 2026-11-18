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
