import { expect, spyOn, test } from "bun:test";
import { computeContainerKekMaterialId } from "./containerKekMaterial";

test("reopening a 4097-epoch history reuses public commitments across byte arrays", async () => {
  const containerId = crypto.randomUUID();
  const keys = Array.from({ length: 4097 }, () =>
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const derivation = spyOn(crypto.subtle, "deriveBits");
  try {
    const ids: Awaited<ReturnType<typeof computeContainerKekMaterialId>>[] = [];
    for (const [ordinal, keyMaterial] of keys.entries()) {
      ids.push(
        await computeContainerKekMaterialId({
          containerId,
          keyEpoch: ordinal + 1,
          keyMaterial,
        }),
      );
    }
    expect(derivation).toHaveBeenCalledTimes(4097);
    for (const [ordinal, keyMaterial] of keys.entries()) {
      const expected = ids[ordinal];
      if (!expected) throw new Error("Missing history commitment");
      expect(
        await computeContainerKekMaterialId({
          containerId,
          keyEpoch: ordinal + 1,
          keyMaterial: keyMaterial.slice(),
        }),
      ).toBe(expected);
    }
    expect(derivation).toHaveBeenCalledTimes(4097);
  } finally {
    derivation.mockRestore();
  }
}, 30_000);

test("commitment caching binds every input and snapshots mutable key bytes", async () => {
  const containerId = crypto.randomUUID();
  const keyMaterial = new Uint8Array(32).fill(33);
  const original = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial,
  });
  const inFlight = computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial,
  });
  keyMaterial[0] = 34;
  expect(await inFlight).toBe(original);
  expect(
    await computeContainerKekMaterialId({
      containerId,
      keyEpoch: 1,
      keyMaterial,
    }),
  ).not.toBe(original);
  keyMaterial[0] = 33;
  expect(
    await computeContainerKekMaterialId({
      containerId,
      keyEpoch: 2,
      keyMaterial,
    }),
  ).not.toBe(original);
  expect(
    await computeContainerKekMaterialId({
      containerId: `${containerId}-other`,
      keyEpoch: 1,
      keyMaterial,
    }),
  ).not.toBe(original);
});
