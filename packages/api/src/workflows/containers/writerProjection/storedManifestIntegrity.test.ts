import { expect, test } from "bun:test";
import { signedContainerHistory } from "../../../../test/helpers/storedManifestHistory";
import { createContainerWriterProjectionContext } from "./context";
import {
  clearStoredContainerManifestVerificationCache,
  verifyStoredContainerManifest,
} from "./storedManifestVerification";

test("a cold history rejects a forged intermediate event", async () => {
  const { bundles, executor, loadBundle } = await signedContainerHistory(3);
  const middle = bundles[1];
  const head = bundles[2];
  if (!middle || !head) throw new Error("Missing history fixture");
  const event = Reflect.get(middle.event, "event");
  Reflect.set(event, "signature", "invalid");
  clearStoredContainerManifestVerificationCache();
  const context = createContainerWriterProjectionContext(executor);
  await expect(
    verifyStoredContainerManifest({ bundle: head, context, loadBundle }),
  ).rejects.toMatchObject({ status: 409 });
  expect(context.verifiedManifestByHash.has(head.manifestHash)).toBe(false);
});

test("a warm process cache does not hide an edited stored head", async () => {
  const { bundles, executor, loadBundle } = await signedContainerHistory(2);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history fixture");
  await verifyStoredContainerManifest({
    bundle: head,
    context: createContainerWriterProjectionContext(executor),
    loadBundle,
  });
  const event = Reflect.get(head.event, "event");
  Reflect.set(event, "signature", "invalid");
  await expect(
    verifyStoredContainerManifest({
      bundle: head,
      context: createContainerWriterProjectionContext(executor),
      loadBundle,
    }),
  ).rejects.toMatchObject({ status: 409 });
  clearStoredContainerManifestVerificationCache();
});
