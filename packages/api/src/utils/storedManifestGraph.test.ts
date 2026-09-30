import { expect, test } from "bun:test";
import { verifyStoredManifestGraph } from "./storedManifestGraph";

test("shared verified dependencies are prepared once before their parents", async () => {
  const prepared: string[] = [];
  const graph: Record<string, string[]> = {
    root: ["left", "right"],
    left: ["shared"],
    right: ["shared"],
    shared: [],
  };
  const result = await verifyStoredManifestGraph({
    rootHash: "root",
    error: (message) => new Error(message),
    prepare: async (hash) => {
      prepared.push(hash);
      const dependencies = graph[hash];
      if (!dependencies) throw new Error("Missing fixture vertex");
      return {
        dependencies,
        verify: async (dependency): Promise<string> =>
          `${hash}(${dependencies.map(dependency).join(",")})`,
      };
    },
  });
  expect(result).toBe("root(left(shared()),right(shared()))");
  expect(prepared).toEqual(["root", "left", "shared", "right"]);
});

test("cyclic or rejected dependencies never verify their parents", async () => {
  for (const cycle of [true, false]) {
    const verified: string[] = [];
    await expect(
      verifyStoredManifestGraph({
        rootHash: "root",
        error: (message) => new Error(message),
        prepare: async (hash) => ({
          dependencies: hash === "root" ? ["child"] : cycle ? ["root"] : [],
          verify: async () => {
            if (hash === "child") throw new Error("Invalid signature");
            verified.push(hash);
            return hash;
          },
        }),
      }),
    ).rejects.toThrow(cycle ? "history contains a cycle" : "Invalid signature");
    expect(verified).toEqual([]);
  }
});
