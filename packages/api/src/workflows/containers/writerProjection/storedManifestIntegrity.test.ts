import { expect, spyOn, test } from "bun:test";
import * as crypto from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { signedContainerHistory } from "../../../../test/helpers/storedManifestHistory";
import { verifyStoredContainerManifest } from "./storedManifestVerification";

const SECRET_ENV = "DOCUMENT_SYNC_CURSOR_HMAC_KEY";

test("an unmarked history rejects a forged intermediate event", async () => {
  const { bundles, createContext, loadBundle, markers } =
    await signedContainerHistory(3);
  const middle = bundles[1];
  const head = bundles[2];
  if (!middle || !head) throw new Error("Missing history fixture");
  const event = Reflect.get(middle.event, "event");
  Reflect.set(event, "signature", "invalid");
  const context = createContext();
  await expect(
    verifyStoredContainerManifest({ bundle: head, context, loadBundle }),
  ).rejects.toMatchObject({ status: 409 });
  expect(context.verifiedManifestByHash.has(head.manifestHash)).toBe(false);
  // Nothing at or above the forgery is attested.
  expect(markers.has(middle.manifestHash)).toBe(false);
  expect(markers.has(head.manifestHash)).toBe(false);
});

test("a marker does not hide an edited stored head", async () => {
  const { bundles, createContext, loadBundle, markers } =
    await signedContainerHistory(2);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history fixture");
  await verifyStoredContainerManifest({
    bundle: head,
    context: createContext(),
    loadBundle,
  });
  expect(markers.has(head.manifestHash)).toBe(true);
  const event = Reflect.get(head.event, "event");
  Reflect.set(event, "signature", "invalid");
  await expect(
    verifyStoredContainerManifest({
      bundle: head,
      context: createContext(),
      loadBundle,
    }),
  ).rejects.toMatchObject({ status: 409 });
});

test("a marker does not survive an edited signer key", async () => {
  const { bundles, createContext, loadBundle, signerRow } =
    await signedContainerHistory(2);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history fixture");
  await verifyStoredContainerManifest({
    bundle: head,
    context: createContext(),
    loadBundle,
  });
  signerRow.signingPublicKey = bytesToBase64(
    crypto.generateSigningSeedAndKeyPair().signingPublicKey,
  );
  await expect(
    verifyStoredContainerManifest({
      bundle: head,
      context: createContext(),
      loadBundle,
    }),
  ).rejects.toMatchObject({ status: 409 });
});

test("a marker without the server secret is ignored", async () => {
  const { bundles, createContext, loadBundle, markers } =
    await signedContainerHistory(3);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history fixture");
  // A database writer can insert rows, but cannot compute their MAC.
  for (const bundle of bundles) {
    markers.set(bundle.manifestHash, Buffer.alloc(32).toString("base64"));
  }
  const verify = spyOn(crypto, "verifySignedAccessEvent");
  try {
    await verifyStoredContainerManifest({
      bundle: head,
      context: createContext(),
      loadBundle,
    });
    expect(verify).toHaveBeenCalledTimes(3);
  } finally {
    verify.mockRestore();
  }
});

test("rotating the server secret retires every marker", async () => {
  const { bundles, createContext, loadBundle } =
    await signedContainerHistory(3);
  const head = bundles.at(-1);
  if (!head) throw new Error("Missing history fixture");
  await verifyStoredContainerManifest({
    bundle: head,
    context: createContext(),
    loadBundle,
  });
  const previous = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = "a-rotated-document-sync-cursor-secret-value";
  const verify = spyOn(crypto, "verifySignedAccessEvent");
  try {
    await verifyStoredContainerManifest({
      bundle: head,
      context: createContext(),
      loadBundle,
    });
    expect(verify).toHaveBeenCalledTimes(3);
  } finally {
    verify.mockRestore();
    if (previous === undefined) delete process.env[SECRET_ENV];
    else process.env[SECRET_ENV] = previous;
  }
});
