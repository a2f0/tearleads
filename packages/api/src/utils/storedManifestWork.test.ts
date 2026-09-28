import { expect, test } from "bun:test";
import { StoredManifestWork } from "./storedManifestWork";

test("only identical pending sources in one database session share work", async () => {
  const work = new StoredManifestWork<number>(2);
  const scope = {};
  const gate = Promise.withResolvers<void>();
  let verifications = 0;
  const verify = async () => {
    verifications += 1;
    await gate.promise;
    return verifications;
  };
  const first = work.run({ scope, key: "head", source: "signed", verify });
  const same = work.run({ scope, key: "head", source: "signed", verify });
  const changed = work.run({ scope, key: "head", source: "edited", verify });
  const otherSession = work.run({
    scope: {},
    key: "head",
    source: "signed",
    verify,
  });
  await Promise.resolve();
  expect(verifications).toBe(3);
  gate.resolve();
  await Promise.all([first, same, changed, otherSession]);
});

test("failed verification is retried and never retained as a head", async () => {
  const work = new StoredManifestWork<string>(2);
  const input = { scope: {}, key: "head", source: "signed" };
  await expect(
    work.run({
      ...input,
      verify: async () => {
        throw new Error("missing");
      },
    }),
  ).rejects.toThrow("missing");
  expect(work.get(input.key, input.source)).toBeUndefined();
  expect(await work.run({ ...input, verify: async () => "verified" })).toBe(
    "verified",
  );
});

test("head retention is bounded and validates the complete source", async () => {
  const work = new StoredManifestWork<string>(2);
  for (const key of ["first", "second", "third"]) {
    await work.run({
      scope: {},
      key,
      source: { signer: key },
      verify: async () => key,
    });
  }
  expect(work.get("first", { signer: "first" })).toBeUndefined();
  expect(work.get("second", { signer: "second" })).toBe("second");
  expect(work.get("third", { signer: "different" })).toBeUndefined();
});

test("clearing during verification cannot repopulate heads from the old generation", async () => {
  const work = new StoredManifestWork<string>(2);
  const gate = Promise.withResolvers<string>();
  const input = { scope: {}, key: "head", source: "signed" };
  const old = work.run({ ...input, verify: () => gate.promise });
  work.clear();
  gate.resolve("old");
  await old;
  expect(work.get(input.key, input.source)).toBeUndefined();
  expect(await work.run({ ...input, verify: async () => "new" })).toBe("new");
});

test("editing an in-flight source cannot relabel the verified result", async () => {
  const work = new StoredManifestWork<string>(2);
  const gate = Promise.withResolvers<string>();
  const source = { signer: "original" };
  const pending = work.run({
    scope: {},
    key: "head",
    source,
    verify: () => gate.promise,
  });
  source.signer = "edited";
  gate.resolve("verified original");
  await pending;
  expect(work.get("head", source)).toBeUndefined();
  expect(work.get("head", { signer: "original" })).toBeUndefined();
});
