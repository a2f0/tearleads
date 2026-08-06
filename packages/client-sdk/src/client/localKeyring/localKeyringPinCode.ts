import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  assertEnvelopeContextMatches,
  assertNonEmptyString,
  assertWrappedLocalSecretEnvelope,
  type BrowserLocalKeyringOptions,
  copyBytes,
  createIndexedDbWrappingKeyKeystore,
  createLocalKeyring,
  type LocalKeyring,
  type LocalKeyringScope,
  normalizeLocalKeyringScope,
  resolveBrowserLocalKeyringManifestStore,
  type UnwrapLocalSecretInput,
  WRAPPED_LOCAL_SECRET_FORMAT,
  type WrapLocalSecretInput,
  type WrappedLocalSecretEnvelope,
  type WrappingKeyHandle,
  type WrappingKeyKeystore,
} from "./index";
import {
  createPinCodeWrappingKeyId,
  createPinCodeWrappingKeyMetadata,
  derivePinCodeWrappingKey,
  type LocalKeyringPinCode,
  normalizeKdfIterations,
  PIN_CODE_PROVIDER,
  PIN_CODE_WRAPPING_ALGORITHM,
  parsePinCodeWrappingKeyId,
  parseWrappedLocalSecretEnvelopeBytes,
  pinCodeAdditionalData,
  randomAesGcmIv,
  serializeWrappedLocalSecretEnvelope,
} from "./localKeyringPinCodeSupport";

export type { LocalKeyringPinCode };

export interface PinCodeWrappingKeyKeystoreOptions {
  readonly innerKeystore: WrappingKeyKeystore;
  readonly kdfIterations?: number | undefined;
  readonly pinCode: LocalKeyringPinCode;
  readonly provider?: string | undefined;
}

export type PinCodeBrowserLocalKeyringOptions = Omit<
  BrowserLocalKeyringOptions,
  "provider"
> & {
  readonly kdfIterations?: number | undefined;
  readonly pinCode: LocalKeyringPinCode;
  readonly pinCodeProvider?: string | undefined;
  readonly wrappingKeyProvider?: string | undefined;
};

class PinCodeWrappingKeyKeystore implements WrappingKeyKeystore {
  readonly provider: string;
  private readonly innerKeystore: WrappingKeyKeystore;
  private readonly kdfIterations: number;
  private readonly pinCode: LocalKeyringPinCode;

  constructor(options: PinCodeWrappingKeyKeystoreOptions) {
    this.innerKeystore = options.innerKeystore;
    this.kdfIterations = normalizeKdfIterations(options.kdfIterations);
    this.pinCode = options.pinCode;
    this.provider = options.provider ?? PIN_CODE_PROVIDER;

    assertNonEmptyString(this.provider, "PIN code wrapping key provider");
  }

  close(): void {
    this.innerKeystore.close?.();
  }

  async deleteWrappingKey(scope: LocalKeyringScope): Promise<void> {
    await this.innerKeystore.deleteWrappingKey(scope);
  }

  async getOrCreateWrappingKey(
    scope: LocalKeyringScope,
  ): Promise<WrappingKeyHandle> {
    const innerHandle = await this.innerKeystore.getOrCreateWrappingKey(
      normalizeLocalKeyringScope(scope),
    );
    const metadata = createPinCodeWrappingKeyMetadata({
      innerHandle,
      iterations: this.kdfIterations,
    });

    return {
      keyId: createPinCodeWrappingKeyId(metadata),
      provider: this.provider,
    };
  }

  async unwrapSecret({
    context,
    envelope,
  }: UnwrapLocalSecretInput): Promise<Uint8Array<ArrayBuffer>> {
    assertWrappedLocalSecretEnvelope(envelope);
    assertEnvelopeContextMatches({
      actual: envelope.context,
      expected: context,
    });
    if (envelope.provider !== this.provider) {
      throw new Error("Wrapped local secret provider is unsupported.");
    }
    if (envelope.algorithm !== PIN_CODE_WRAPPING_ALGORITHM) {
      throw new Error("Wrapped local secret algorithm is unsupported.");
    }
    if (!envelope.iv) {
      throw new Error("Wrapped local secret IV is required.");
    }

    const metadata = parsePinCodeWrappingKeyId(envelope.keyId);
    const key = await derivePinCodeWrappingKey({
      metadata,
      pinCode: this.pinCode,
    });

    let innerEnvelope: WrappedLocalSecretEnvelope;
    try {
      innerEnvelope = parseWrappedLocalSecretEnvelopeBytes(
        await crypto.subtle.decrypt(
          {
            additionalData: pinCodeAdditionalData({
              context,
              keyId: envelope.keyId,
              provider: this.provider,
            }),
            iv: copyBytes(base64ToBytes(envelope.iv)),
            name: "AES-GCM",
          },
          key,
          copyBytes(base64ToBytes(envelope.ciphertext)),
        ),
      );
    } catch (error) {
      throw new Error(
        "PIN code is incorrect or wrapped local secret could not be unwrapped.",
        { cause: error },
      );
    }

    assertEnvelopeContextMatches({
      actual: innerEnvelope.context,
      expected: context,
    });
    if (
      innerEnvelope.provider !== metadata.innerProvider ||
      innerEnvelope.keyId !== metadata.innerKeyId
    ) {
      throw new Error("PIN code inner wrapping key does not match.");
    }

    return this.innerKeystore.unwrapSecret({
      context,
      envelope: innerEnvelope,
    });
  }

  async wrapSecret({
    context,
    handle,
    plaintext,
  }: WrapLocalSecretInput): Promise<WrappedLocalSecretEnvelope> {
    if (handle.provider !== this.provider) {
      throw new Error("Wrapping key handle provider is unsupported.");
    }
    const metadata = parsePinCodeWrappingKeyId(handle.keyId);
    const innerEnvelope = await this.innerKeystore.wrapSecret({
      context,
      handle: {
        keyId: metadata.innerKeyId,
        provider: metadata.innerProvider,
      },
      plaintext,
    });
    const key = await derivePinCodeWrappingKey({
      metadata,
      pinCode: this.pinCode,
    });
    const iv = randomAesGcmIv();
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          additionalData: pinCodeAdditionalData({
            context,
            keyId: handle.keyId,
            provider: this.provider,
          }),
          iv,
          name: "AES-GCM",
        },
        key,
        serializeWrappedLocalSecretEnvelope(innerEnvelope),
      ),
    );

    return {
      algorithm: PIN_CODE_WRAPPING_ALGORITHM,
      ciphertext: bytesToBase64(ciphertext),
      context,
      format: WRAPPED_LOCAL_SECRET_FORMAT,
      iv: bytesToBase64(iv),
      keyId: handle.keyId,
      provider: this.provider,
      version: 1,
      wrappedAt: new Date().toISOString(),
    };
  }
}

export function createPinCodeWrappingKeyKeystore(
  options: PinCodeWrappingKeyKeystoreOptions,
): WrappingKeyKeystore {
  return new PinCodeWrappingKeyKeystore(options);
}

export function isPinCodeWrappedLocalSecretEnvelope(
  envelope: WrappedLocalSecretEnvelope,
): boolean {
  return (
    envelope.provider === PIN_CODE_PROVIDER &&
    envelope.algorithm === PIN_CODE_WRAPPING_ALGORITHM
  );
}

export function createPinCodeBrowserLocalKeyring(
  options: PinCodeBrowserLocalKeyringOptions,
): LocalKeyring {
  return createLocalKeyring({
    keystore: createPinCodeWrappingKeyKeystore({
      innerKeystore: createIndexedDbWrappingKeyKeystore({
        databaseName: options.databaseName,
        indexedDB: options.indexedDB,
        // Must match the non-PIN keyring's mode for the same shell. The inner
        // keystore reads the wrapping-key record written by whichever keyring
        // ran first, and the raw-bytes and CryptoKey record formats are not
        // interchangeable. WKWebView shells (Capacitor/Electrobun)
        // cannot structured-clone a CryptoKey at all, so without this the PIN
        // keyring would throw DataCloneError where the plain one works.
        keyMaterialStorage: options.keyMaterialStorage,
        objectStoreName: options.objectStoreName,
        provider: options.wrappingKeyProvider,
      }),
      kdfIterations: options.kdfIterations,
      pinCode: options.pinCode,
      provider: options.pinCodeProvider,
    }),
    manifestStore: resolveBrowserLocalKeyringManifestStore(options),
    now: options.now,
  });
}
