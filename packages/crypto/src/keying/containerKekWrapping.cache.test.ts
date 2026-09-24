import { expect, spyOn, test } from "bun:test";
import { deriveContainerKekWrappingPublicKey } from "./containerKekWrapping";

test("public-key caching avoids derivation and follows mutable KEK contents", async () => {
  const containerId = crypto.randomUUID();
  const keyMaterial = new Uint8Array(32).fill(71);
  const derivation = spyOn(crypto.subtle, "deriveBits");
  try {
    const original = await deriveContainerKekWrappingPublicKey({
      containerId,
      keyMaterial,
    });
    expect(
      await deriveContainerKekWrappingPublicKey({
        containerId,
        keyMaterial: keyMaterial.slice(),
      }),
    ).toBe(original);
    expect(derivation).toHaveBeenCalledTimes(1);
    keyMaterial[0] = 72;
    expect(
      await deriveContainerKekWrappingPublicKey({ containerId, keyMaterial }),
    ).not.toBe(original);
    expect(derivation).toHaveBeenCalledTimes(2);
    keyMaterial[0] = 71;
    expect(
      await deriveContainerKekWrappingPublicKey({ containerId, keyMaterial }),
    ).toBe(original);
    expect(derivation).toHaveBeenCalledTimes(2);
    await expect(
      deriveContainerKekWrappingPublicKey({
        containerId,
        keyMaterial: new Uint8Array(1),
      }),
    ).rejects.toThrow("32-byte KEK");
    expect(keyMaterial).toEqual(new Uint8Array(32).fill(71));
  } finally {
    derivation.mockRestore();
  }
});
