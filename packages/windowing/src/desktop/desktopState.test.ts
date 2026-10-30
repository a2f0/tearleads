import { afterEach, expect, test } from "bun:test";
import {
  DESKTOP_ICON_GRID,
  EMPTY_DESKTOP_STATE,
  parseDesktopState,
  resolveDesktopIconPositions,
  serializeDesktopState,
} from "./desktopState";
import {
  createMemoryDesktopStateStorage,
  createOpfsDesktopStateStorage,
} from "./desktopStateStorage";

const { cellHeight, cellWidth, originX, originY } = DESKTOP_ICON_GRID;

test("state round-trips through its serialized form", () => {
  const state = { icons: { explorer: { x: 40, y: 120 } } };
  expect(parseDesktopState(serializeDesktopState(state))).toEqual(state);
});

test("unreadable state reads as empty, keeping what is well formed", () => {
  expect(parseDesktopState(null)).toBe(EMPTY_DESKTOP_STATE);
  expect(parseDesktopState("{")).toBe(EMPTY_DESKTOP_STATE);
  expect(parseDesktopState("[]")).toBe(EMPTY_DESKTOP_STATE);
  expect(
    parseDesktopState(JSON.stringify({ icons: { a: { x: 1, y: 2 } } })),
  ).toBe(EMPTY_DESKTOP_STATE);
  expect(
    parseDesktopState(
      JSON.stringify({
        icons: {
          bad: { x: "1", y: 2 },
          good: { x: 10.4, y: -3 },
          none: null,
        },
        version: 1,
      }),
    ),
  ).toEqual({ icons: { good: { x: 10, y: 0 } } });
});

test("icons without a stored position fill free grid slots in order", () => {
  const surfaceHeight = originY + cellHeight * 2;
  const positions = resolveDesktopIconPositions(
    ["a", "b", "c", "d"],
    { b: { x: originX, y: originY } },
    surfaceHeight,
  );
  expect(positions).toEqual({
    a: { x: originX, y: originY + cellHeight },
    b: { x: originX, y: originY },
    c: { x: originX + cellWidth, y: originY },
    d: { x: originX + cellWidth, y: originY + cellHeight },
  });
});

test("an unmeasured surface lays icons out in one row", () => {
  expect(resolveDesktopIconPositions(["a", "b"], {}, 0)).toEqual({
    a: { x: originX, y: originY },
    b: { x: originX + cellWidth, y: originY },
  });
});

test("memory storage keeps the last write", async () => {
  const storage = createMemoryDesktopStateStorage("first");
  expect(await storage.read()).toBe("first");
  await storage.write("second");
  expect(await storage.read()).toBe("second");
});

// A minimal origin private file system: directories of text files.
class FakeFile {
  constructor(public text = "") {}
}

class FakeDirectory {
  readonly directories = new Map<string, FakeDirectory>();
  readonly files = new Map<string, FakeFile>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let directory = this.directories.get(name);
    if (!directory) {
      if (!options?.create) {
        throw new DOMException("missing", "NotFoundError");
      }
      directory = new FakeDirectory();
      this.directories.set(name, directory);
    }
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    let file = this.files.get(name);
    if (!file) {
      if (!options?.create) {
        throw new DOMException("missing", "NotFoundError");
      }
      file = new FakeFile();
      this.files.set(name, file);
    }
    const target = file;
    return {
      createWritable: async () => {
        let pending = "";
        return {
          abort: async () => {},
          close: async () => {
            target.text = pending;
          },
          write: async (data: string) => {
            pending += data;
          },
        };
      },
      getFile: async () => ({ text: async () => target.text }),
    };
  }
}

const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

function installOpfs(root: FakeDirectory | null) {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: root ? { getDirectory: async () => root } : {},
  });
}

afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(navigator, "storage", originalStorage);
  }
});

test("OPFS storage reads null until written, then the written text", async () => {
  const root = new FakeDirectory();
  installOpfs(root);
  const storage = createOpfsDesktopStateStorage({
    directory: ["site", "desktop"],
    fileName: "icons.json",
  });

  expect(await storage.read()).toBeNull();
  await storage.write('{"version":1}');
  expect(await storage.read()).toBe('{"version":1}');
  const saved = root.directories
    .get("site")
    ?.directories.get("desktop")
    ?.files.get("icons.json");
  expect(saved?.text).toBe('{"version":1}');
});

test("OPFS storage rejects where the browser has none", async () => {
  installOpfs(null);
  const storage = createOpfsDesktopStateStorage();
  await expect(storage.read()).rejects.toThrow(
    "The origin private file system is not available.",
  );
  await expect(storage.write("{}")).rejects.toThrow();
});
