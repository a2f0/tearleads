import { expect, mock, test } from "bun:test";
import { checkSeedBytes, discoverSeedDocuments } from "./verifySeedDownloads";

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
