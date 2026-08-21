import {
  createBrowserLocalKeyring,
  createIndexedDbWrappingKeyKeystore,
  createPinCodeBrowserLocalKeyring,
  createPinCodeWrappingKeyKeystore,
  isPinCodeWrappedLocalSecretEnvelope,
  type LocalKeyring,
  type LocalKeyringManifest,
  type LocalKeyringManifestStore,
  type LocalKeyringScope,
  type LocalSecretContext,
  type WrappingKeyKeystore,
  type WrappingKeyMaterialStorage,
} from "@symcrypt/client-sdk";
import { getLocalStorage } from "../../utils/storedPreference";

export type LocalKeyringLockStatus = "unavailable" | "unlocked" | "locked";
export type BrowserStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export interface LockSnapshot {
  readonly pinCodeEnabled: boolean;
  readonly status: LocalKeyringLockStatus;
}

export interface LockState extends LockSnapshot {
  readonly revision: number;
}

/** A keyring factory whose implementation cache can be retired after a hang. */
export type LocalKeyringFactory = (() => LocalKeyring) & {
  readonly invalidateCachedKeyring?: () => void;
};

export interface LocalKeyringLockEnvironment {
  readonly canManagePinCode: boolean;
  readonly hostCreateLocalKeyring: (() => LocalKeyring) | undefined;
  /**
   * How this shell persists the IndexedDB wrapping key. WKWebView shells
   * (Capacitor/Electrobun) must use "raw-bytes"; browsers use the default
   * non-extractable CryptoKey. Every keystore built here threads it through so
   * the PIN and non-PIN keyrings agree on the record shape they read and write.
   */
  readonly keyMaterialStorage: WrappingKeyMaterialStorage | undefined;
  readonly manifestStore: LocalKeyringManifestStore | null;
  readonly pinCodeConfigNamespace: string | null;
  readonly scopes: readonly LocalKeyringScope[];
  readonly storage: BrowserStorage | null;
}

type ManageableLockEnvironment = LocalKeyringLockEnvironment & {
  readonly manifestStore: LocalKeyringManifestStore;
  readonly pinCodeConfigNamespace: string;
};

// The gate every PIN action shares: management enabled for this shell, a
// manifest store and config namespace to act on, and a non-empty PIN.
export function canRunPinCodeAction(
  environment: LocalKeyringLockEnvironment,
  pinCode: string,
): environment is ManageableLockEnvironment {
  return Boolean(
    environment.canManagePinCode &&
      environment.manifestStore &&
      environment.pinCodeConfigNamespace &&
      pinCode,
  );
}

const PIN_CODE_CONFIG_PREFIX = "symcrypt.local-keyring.pin-code:";

export function pinCodeConfigKey(namespace: string): string {
  return `${PIN_CODE_CONFIG_PREFIX}${namespace}`;
}

export function getBrowserStorage(): BrowserStorage | null {
  return getLocalStorage();
}

export function isBrowserKeyringSupported(
  storage: BrowserStorage | null,
): boolean {
  return typeof globalThis.indexedDB !== "undefined" && storage !== null;
}

/**
 * The host-supplied keyring when the shell injects a factory; otherwise the
 * browser keyring when the environment supports it (IndexedDB plus browser
 * storage); otherwise null.
 */
export function createHostLocalKeyring(input: {
  readonly createLocalKeyring: (() => LocalKeyring) | undefined;
  readonly storage: BrowserStorage | null;
}): LocalKeyring | null {
  if (input.createLocalKeyring) {
    return input.createLocalKeyring();
  }
  return isBrowserKeyringSupported(input.storage)
    ? createBrowserLocalKeyring()
    : null;
}

function localSecretContext(
  manifest: LocalKeyringManifest,
): LocalSecretContext {
  return {
    purpose: "account-root",
    scope: manifest.scope,
  };
}

export function createPlainKeystore(
  keyMaterialStorage: WrappingKeyMaterialStorage | undefined,
): WrappingKeyKeystore {
  return createIndexedDbWrappingKeyKeystore({ keyMaterialStorage });
}

export function createPinKeystore(input: {
  readonly keyMaterialStorage: WrappingKeyMaterialStorage | undefined;
  readonly pinCode: string;
}): WrappingKeyKeystore {
  return createPinCodeWrappingKeyKeystore({
    innerKeystore: createPlainKeystore(input.keyMaterialStorage),
    pinCode: input.pinCode,
  });
}

function createLockedLocalKeyring(): LocalKeyring {
  return {
    close() {},
    async deleteSession() {
      throw new Error("Local keyring is locked.");
    },
    async getOrCreateSession() {
      throw new Error("Local keyring is locked.");
    },
    async loadSession() {
      return null;
    },
  };
}

export function createDynamicLocalKeyring(
  resolveLocalKeyring: () => LocalKeyring | null,
  closeLocalKeyring: () => void,
): LocalKeyring {
  let closed = false;

  function currentKeyring(): LocalKeyring {
    if (closed) {
      throw new Error("Local keyring is closed.");
    }
    const keyring = resolveLocalKeyring();
    return keyring ?? createLockedLocalKeyring();
  }

  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      closeLocalKeyring();
    },
    deleteSession: (scope) => currentKeyring().deleteSession(scope),
    getOrCreateSession: (scope) => currentKeyring().getOrCreateSession(scope),
    loadSession: (scope) => currentKeyring().loadSession(scope),
  };
}

export function createBrowserLocalKeyringForPinCode(input: {
  readonly keyMaterialStorage: WrappingKeyMaterialStorage | undefined;
  readonly pinCode: string | null;
}): LocalKeyring {
  const { keyMaterialStorage, pinCode } = input;
  return pinCode
    ? createPinCodeBrowserLocalKeyring({ keyMaterialStorage, pinCode })
    : createBrowserLocalKeyring({ keyMaterialStorage });
}

/**
 * Binds a shell's key-material mode into the `(pinCode) => LocalKeyring` shape
 * the dynamic keyring factory caches on. Kept referentially stable by the
 * caller so the cached keyring survives renders that change nothing.
 */
export function browserLocalKeyringFactory(
  keyMaterialStorage: WrappingKeyMaterialStorage | undefined,
): (pinCode: string | null) => LocalKeyring {
  return (pinCode) =>
    createBrowserLocalKeyringForPinCode({ keyMaterialStorage, pinCode });
}

export function initialLockSnapshot(input: {
  readonly hostManaged: boolean;
  readonly namespace: string | null;
  readonly storage: BrowserStorage | null;
}): LockSnapshot {
  if (
    input.hostManaged ||
    !input.namespace ||
    !isBrowserKeyringSupported(input.storage)
  ) {
    return { pinCodeEnabled: false, status: "unavailable" };
  }

  const enabled =
    input.storage?.getItem(pinCodeConfigKey(input.namespace)) === "1";
  return {
    pinCodeEnabled: enabled,
    status: enabled ? "locked" : "unlocked",
  };
}

export async function hasPinWrappedManifest(input: {
  readonly manifestStore: LocalKeyringManifestStore;
  readonly scopes: readonly LocalKeyringScope[];
}): Promise<boolean> {
  for (const scope of input.scopes) {
    const manifest = await input.manifestStore.loadManifest(scope);
    if (
      manifest &&
      isPinCodeWrappedLocalSecretEnvelope(manifest.rootKeyEnvelope)
    ) {
      return true;
    }
  }

  return false;
}

async function rewrapManifest(input: {
  readonly manifest: LocalKeyringManifest;
  readonly manifestStore: LocalKeyringManifestStore;
  readonly sourceKeystore: WrappingKeyKeystore;
  readonly targetKeystore: WrappingKeyKeystore;
}): Promise<void> {
  const context = localSecretContext(input.manifest);
  const rootKey = await input.sourceKeystore.unwrapSecret({
    context,
    envelope: input.manifest.rootKeyEnvelope,
  });
  try {
    const handle = await input.targetKeystore.getOrCreateWrappingKey(
      input.manifest.scope,
    );
    await input.manifestStore.saveManifest({
      ...input.manifest,
      rootKeyEnvelope: await input.targetKeystore.wrapSecret({
        context,
        handle,
        plaintext: rootKey,
      }),
      updatedAt: new Date().toISOString(),
    });
  } finally {
    rootKey.fill(0);
  }
}

function sourceKeystoreForManifest(input: {
  readonly keyMaterialStorage: WrappingKeyMaterialStorage | undefined;
  readonly manifest: LocalKeyringManifest;
  readonly pinCode: string | null;
}): WrappingKeyKeystore {
  if (!isPinCodeWrappedLocalSecretEnvelope(input.manifest.rootKeyEnvelope)) {
    return createPlainKeystore(input.keyMaterialStorage);
  }
  if (!input.pinCode) {
    throw new Error("Current PIN code is required.");
  }

  return createPinKeystore({
    keyMaterialStorage: input.keyMaterialStorage,
    pinCode: input.pinCode,
  });
}

export async function rewrapExistingManifests(input: {
  readonly keyMaterialStorage: WrappingKeyMaterialStorage | undefined;
  readonly manifestStore: LocalKeyringManifestStore;
  readonly scopes: readonly LocalKeyringScope[];
  readonly sourcePinCode: string | null;
  readonly targetKeystore: WrappingKeyKeystore;
}): Promise<void> {
  for (const scope of input.scopes) {
    const manifest = await input.manifestStore.loadManifest(scope);
    if (!manifest) {
      continue;
    }

    // One source keystore per manifest, each holding its own IDBDatabase until
    // closed. Leaking them matters most on the WKWebView shells this PIN path
    // newly reaches, where a later indexedDB.open() can hang outright rather
    // than merely wasting a handle. The target keystore spans every scope, so
    // its owner closes it, not this loop.
    const sourceKeystore = sourceKeystoreForManifest({
      keyMaterialStorage: input.keyMaterialStorage,
      manifest,
      pinCode: input.sourcePinCode,
    });
    try {
      await rewrapManifest({
        manifest,
        manifestStore: input.manifestStore,
        sourceKeystore,
        targetKeystore: input.targetKeystore,
      });
    } finally {
      sourceKeystore.close?.();
    }
  }
}

export async function verifyPinCode(input: {
  readonly keyMaterialStorage: WrappingKeyMaterialStorage | undefined;
  readonly manifestStore: LocalKeyringManifestStore;
  readonly pinCode: string;
  readonly scopes: readonly LocalKeyringScope[];
}): Promise<boolean> {
  // Verification runs on every unlock attempt, so a leaked connection here
  // accumulates once per wrong PIN.
  const pinKeystore = createPinKeystore({
    keyMaterialStorage: input.keyMaterialStorage,
    pinCode: input.pinCode,
  });
  try {
    let verifiedAnyManifest = false;
    for (const scope of input.scopes) {
      const manifest = await input.manifestStore.loadManifest(scope);
      if (
        !manifest ||
        !isPinCodeWrappedLocalSecretEnvelope(manifest.rootKeyEnvelope)
      ) {
        continue;
      }

      let rootKey: Uint8Array<ArrayBuffer> | null = null;
      try {
        rootKey = await pinKeystore.unwrapSecret({
          context: localSecretContext(manifest),
          envelope: manifest.rootKeyEnvelope,
        });
      } catch {
        return false;
      } finally {
        rootKey?.fill(0);
      }
      verifiedAnyManifest = true;
    }

    return verifiedAnyManifest;
  } finally {
    pinKeystore.close?.();
  }
}
