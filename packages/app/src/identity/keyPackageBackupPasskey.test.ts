import { afterEach, expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import type { KeyPackageBackupResponse } from "@tearleads/validators/response";
import type { AppKeyPackage } from "./keyPackageBackup";
import {
  createPasskeyProtectedKeyPackageBackup,
  decryptPasskeyProtectedKeyPackageBackup,
  discoverPasskeyKeyPackageBackupCredentialId,
} from "./keyPackageBackupPasskey";

const credentialIdBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
const publicKeyBytes = new Uint8Array([7, 8, 9, 10]);
const prfOutput = new Uint8Array(32).fill(42);
const wrongPrfOutput = new Uint8Array(32).fill(24);
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function descriptor(name: string): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(globalThis, name);
}

function rememberDescriptor(name: string): void {
  if (!originalDescriptors.has(name)) {
    originalDescriptors.set(name, descriptor(name));
  }
}

function defineGlobal(name: string, value: unknown): void {
  rememberDescriptor(name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
  });
}

function restoreGlobals(): void {
  for (const [name, original] of originalDescriptors) {
    if (original) {
      Object.defineProperty(globalThis, name, original);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
  originalDescriptors.clear();
}

function fakeCredential(prfResults?: {
  readonly first?: ArrayBuffer | undefined;
}): Credential {
  return {
    rawId: arrayBuffer(credentialIdBytes),
    response: {
      getPublicKey: () => arrayBuffer(publicKeyBytes),
      getPublicKeyAlgorithm: () => -7,
      getTransports: () => ["internal"],
    },
    getClientExtensionResults: () => ({
      prf: prfResults
        ? { enabled: true, results: prfResults }
        : { enabled: true },
    }),
    type: "public-key",
  } as unknown as Credential;
}

function installWebAuthnMock(
  output: Uint8Array = prfOutput,
  options: { readonly createPrfOutput?: boolean } = {},
): { readonly getCallCount: () => number } {
  let getCallCount = 0;
  defineGlobal("window", { isSecureContext: true });
  defineGlobal("PublicKeyCredential", function PublicKeyCredential() {});
  defineGlobal("navigator", {
    credentials: {
      create: async () =>
        fakeCredential(
          options.createPrfOutput === false
            ? undefined
            : { first: arrayBuffer(output) },
        ),
      get: async (options: CredentialRequestOptions) => {
        getCallCount += 1;
        const publicKey = options.publicKey as
          | (PublicKeyCredentialRequestOptions & {
              extensions?: {
                prf?: {
                  eval?: {
                    first?: BufferSource | undefined;
                  };
                };
              };
            })
          | undefined;
        const prfSalt = publicKey?.extensions?.prf?.eval?.first;
        return fakeCredential(
          prfSalt ? { first: arrayBuffer(output) } : undefined,
        );
      },
    },
  });
  return { getCallCount: () => getCallCount };
}

function testKeyPackage(): AppKeyPackage {
  return {
    createdAt: "2026-06-01T12:00:00.000Z",
    encapsulationKeyPair: {
      publicKey: "encapsulation-public-key",
      secretKey: "encapsulation-secret-key",
    },
    format: "tearleads.identity-key-package",
    signingFingerprint: "a".repeat(64),
    signingKeyPair: {
      signingPrivateKey: "signing-private-key",
      signingPublicKey: "signing-public-key",
    },
    version: 1,
    session: {
      containerId: "container-1",
      organizationId: "organization-1",
      userId: "user-1",
    },
  };
}

function responseFromRequest(
  request: Awaited<ReturnType<typeof createPasskeyProtectedKeyPackageBackup>>,
): KeyPackageBackupResponse {
  return {
    ...request,
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    userId: "user-1",
  };
}

afterEach(() => {
  restoreGlobals();
});

test("passkey key package backup encrypts and decrypts locally", async () => {
  installWebAuthnMock();

  const request = await createPasskeyProtectedKeyPackageBackup({
    keyPackage: testKeyPackage(),
    signingKeyFingerprint: "a".repeat(64),
  });
  const decrypted = await decryptPasskeyProtectedKeyPackageBackup(
    responseFromRequest(request),
  );

  expect(request.credential.id).toBe(bytesToBase64(credentialIdBytes));
  expect(request.envelope.ciphertext).not.toContain("signing-private-key");
  expect(decrypted).toEqual(testKeyPackage());
});

test("passkey key package backup reuses creation PRF output", async () => {
  const webAuthn = installWebAuthnMock();

  await createPasskeyProtectedKeyPackageBackup({
    keyPackage: testKeyPackage(),
    signingKeyFingerprint: "a".repeat(64),
  });

  expect(webAuthn.getCallCount()).toBe(0);
});

test("passkey key package backup falls back when creation omits PRF output", async () => {
  const webAuthn = installWebAuthnMock(prfOutput, { createPrfOutput: false });

  await createPasskeyProtectedKeyPackageBackup({
    keyPackage: testKeyPackage(),
    signingKeyFingerprint: "a".repeat(64),
  });

  expect(webAuthn.getCallCount()).toBe(1);
});

test("passkey key package backup discovers the credential id", async () => {
  installWebAuthnMock();

  await expect(discoverPasskeyKeyPackageBackupCredentialId()).resolves.toBe(
    bytesToBase64(credentialIdBytes),
  );
});

test("passkey key package backup fails when associated data changes", async () => {
  installWebAuthnMock();
  const request = await createPasskeyProtectedKeyPackageBackup({
    keyPackage: testKeyPackage(),
    signingKeyFingerprint: "a".repeat(64),
  });
  const response = responseFromRequest(request);

  await expect(
    decryptPasskeyProtectedKeyPackageBackup({
      ...response,
      signingKeyFingerprint: "b".repeat(64),
    }),
  ).rejects.toThrow();
});

test("passkey key package backup fails with the wrong PRF output", async () => {
  installWebAuthnMock();
  const request = await createPasskeyProtectedKeyPackageBackup({
    keyPackage: testKeyPackage(),
    signingKeyFingerprint: "a".repeat(64),
  });
  installWebAuthnMock(wrongPrfOutput);

  await expect(
    decryptPasskeyProtectedKeyPackageBackup(responseFromRequest(request)),
  ).rejects.toThrow();
});
