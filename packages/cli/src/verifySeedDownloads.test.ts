import { expect, mock, test } from "bun:test";
import {
  checkSeedBytes,
  discoverSeedDocuments,
  hasSeedPlacement,
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

test("a fixture whose only placement is under Trash is missing, while other folders can finish", async () => {
  const org = "550e8400-e29b-41d4-a716-446655440001";
  const node = (
    id: string,
    parentId: string | null,
    systemSlot: string | null = null,
  ) => ({
    id,
    parentId,
    systemSlot,
    organizationId: org,
  });
  const folders = [
    node("root", null),
    node("bin", "root", "sys_v1_5FZNtQCXR9C9luuE3hGAdd-wTCyE9Fvauhupv8rsyaU"),
    node("child", "bin"),
    node("live", "root"),
  ];
  const listed: string[] = [];
  const passes = new Set<string>();
  const actual: string[] = [];
  for await (const { row } of discoverSeedDocuments(
    folders,
    async (id) => {
      listed.push(id);
      if (id === "root" && listed.length === 1) return null;
      if (passes.has(id)) return [];
      passes.add(id);
      return id === "root"
        ? []
        : [
            { documentId: "moved-to-trash" },
            { documentId: id === "child" ? "trashed-fixture" : id },
          ];
    },
    async () =>
      new Map([
        ["live", ["live"]],
        ["moved-to-trash", ["child"]],
        ["trashed-fixture", ["child"]],
        ["bin", ["bin"]],
      ]),
  ))
    actual.push(row.documentId ?? "");
  expect(actual).toEqual(["live"]);
  expect(listed).toEqual(["root", "live", "live", "root"]);
});

test("deferred head verification waits for the SDK retry time", async () => {
  let now = 0;
  const seen: number[] = [];
  for await (const _ of discoverSeedDocuments(
    [{ id: "folder", organizationId: "org", parentId: null, systemSlot: null }],
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

test.each(["listing", "links"])(
  "discovery stops a pending %s at its deadline",
  async (stage) => {
    const deadline = new AbortController();
    const entered = Promise.withResolvers<void>();
    const stalled = async (): Promise<never> => {
      entered.resolve();
      return new Promise(() => {});
    };
    const rows = discoverSeedDocuments(
      [{ id: "root", organizationId: "org", parentId: null, systemSlot: null }],
      () =>
        stage === "listing"
          ? stalled()
          : Promise.resolve([{ documentId: "fixture" }]),
      stalled,
      undefined,
      deadline.signal,
    );
    const read = rows.next();
    await entered.promise;
    deadline.abort();
    await expect(read).rejects.toThrow("Document discovery timed out");
  },
);

test("a healthy page can verify multiple heads beyond one request timeout", async () => {
  let now = 0;
  const deadline = new AbortController();
  const checked: string[] = [];
  for await (const { row } of discoverSeedDocuments(
    [{ id: "folder", organizationId: "org", parentId: null, systemSlot: null }],
    async (_id, _pending, signal) => {
      expect(signal).toBe(deadline.signal);
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
    deadline.signal,
  ))
    checked.push(row.documentId);
  expect(checked).toEqual(["slow-page"]);
});

test("a contact discovered in the root still needs a signed Contacts link", () => {
  expect(hasSeedPlacement(["root"], "root", "contacts")).toBe(false);
  expect(hasSeedPlacement(["contacts"], "root", "contacts")).toBe(false);
  expect(hasSeedPlacement(["contacts", "root"], "root", "contacts")).toBe(true);
});
