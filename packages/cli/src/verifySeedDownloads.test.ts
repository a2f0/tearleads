import { expect, mock, test } from "bun:test";
import {
  checkSeedBytes,
  discoverSeedDocuments,
  hasSeedPlacement,
  verifiedSeedStorageKeys,
} from "./verifySeedDownloads";

test("verification refuses oversized held files before issuing a read", async () => {
  const read = mock(async () => new Uint8Array());
  await expect(
    checkSeedBytes(
      { byteLength: 1_000_000_000, read },
      new Uint8Array(3),
      "saw",
    ),
  ).rejects.toThrow("Attachment bytes differ: saw");
  expect(read).not.toHaveBeenCalled();
});

test("discovery verifies the seed folders and rejects listings linked only elsewhere", async () => {
  const folders = ["root", "contacts"];
  const listed: string[] = [];
  const passes = new Set<string>();
  const actual: string[] = [];
  for await (const { row } of discoverSeedDocuments(
    folders,
    async (id) => {
      listed.push(id);
      if (id !== "root" && id !== "contacts")
        throw new Error("Unrelated folder unavailable");
      if (id === "root" && listed.length === 1) return null;
      if (passes.has(id)) return [];
      passes.add(id);
      return id === "root"
        ? []
        : [{ documentId: "moved-to-trash" }, { documentId: id }];
    },
    async () =>
      new Map([
        ["contacts", ["contacts"]],
        ["moved-to-trash", ["child"]],
        ["trashed-fixture", ["child"]],
        ["bin", ["bin"]],
      ]),
  ))
    actual.push(row.documentId ?? "");
  expect(actual).toEqual(["contacts"]);
  expect(listed).toEqual(["root", "contacts", "contacts", "root"]);
});

test("deferred head verification waits for the SDK retry time", async () => {
  let now = 0;
  const seen: number[] = [];
  for await (const _ of discoverSeedDocuments(
    ["folder"],
    async (_id, onPending) => {
      seen.push(now);
      if (!now) {
        onPending(15 * 60_000);
        return null;
      }
      return [];
    },
    async () => new Map(),
    {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  ))
    throw new Error("Unexpected fixture");
  expect(seen).toEqual([0, 900_000]);
});

test("a healthy page can verify multiple heads beyond one request timeout", async () => {
  let now = 0;
  const checked: string[] = [];
  for await (const { row } of discoverSeedDocuments(
    ["folder"],
    async () => {
      if (now) return [];
      now += 45_000;
      return [{ documentId: "slow-page" }];
    },
    async () => new Map([["slow-page", ["folder"]]]),
    {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  ))
    checked.push(row.documentId);
  expect(checked).toEqual(["slow-page"]);
});

test("a contact discovered in the root still needs a signed Contacts link", () => {
  expect(hasSeedPlacement(["root"], "root", "contacts")).toBe(false);
  expect(hasSeedPlacement(["contacts"], "root", "contacts")).toBe(false);
  expect(hasSeedPlacement(["contacts", "root"], "root", "contacts")).toBe(true);
});

test("verification checks active bindings even on fixtures without files", () => {
  const slot = { slotId: "a", blobId: "b" };
  const held = [{ ...slot, storageKey: "bytes", detachedAt: null }];
  const verified = new Map([[slot.slotId, slot]]);
  expect(verifiedSeedStorageKeys("empty", [], [], [], verified)).toEqual(
    new Map(),
  );
  expect(
    verifiedSeedStorageKeys("document", ["a"], [slot], held, verified).get("a"),
  ).toBe("bytes");
  expect(() =>
    verifiedSeedStorageKeys("empty", [], [slot], held, verified),
  ).toThrow("bindings differ");
  expect(() =>
    verifiedSeedStorageKeys(
      "document",
      ["a", "b"],
      [slot, slot],
      held,
      verified,
    ),
  ).toThrow("bindings differ");
  expect(() =>
    verifiedSeedStorageKeys("document", ["a"], null, held, verified),
  ).toThrow("bindings differ");
  expect(() =>
    verifiedSeedStorageKeys(
      "document",
      ["a"],
      [{ ...slot, blobId: "replacement" }],
      held,
      verified,
    ),
  ).toThrow("bindings differ");
});

test("a continuation finishing after the discovery deadline cannot return a fixture", async () => {
  let now = 0;
  const collect = async () => {
    for await (const _ of discoverSeedDocuments(
      ["folder"],
      async () => {
        now += 60 * 60_000 + 1;
        return [{ documentId: "late" }];
      },
      async () => new Map([["late", ["folder"]]]),
      { now: () => now, sleep: async () => {} },
    )) {
      throw new Error("Late fixture accepted");
    }
  };
  await expect(collect()).rejects.toThrow(
    "Document discovery timed out in folder",
  );
});
