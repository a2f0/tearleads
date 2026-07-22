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
} from "@tearleads/client-sdk";

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
  readonly manifestStore: LocalKeyringManifestStore | null;
  readonly pinCodeConfigNamespace: string | null;
  readonly scopes: readonly LocalKeyringScope[];
  readonly storage: BrowserStorage | null;
}

const PIN_CODE_CONFIG_PREFIX = "tearleads.local-keyring.pin-code:";

export function pinCodeConfigKey(namespace: string): string {
  return `${PIN_CODE_CONFIG_PREFIX}${namespace}`;
}

export function getBrowserStorage(): BrowserStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function isBrowserKeyringSupported(
  storage: BrowserStorage | null,
): boolean {
  return typeof globalThis.indexedDB !== "undefined" && storage !== null;
}

function localSecretContext(
  manifest: LocalKeyringManifest,
): LocalSecretContext {
  return {
    purpose: "account-root",
    scope: manifest.scope,
  };
}

export function createPlainKeystore(): WrappingKeyKeystore {
  return createIndexedDbWrappingKeyKeystore();
}

export function createPinKeystore(pinCode: string): WrappingKeyKeystore {
  return createPinCodeWrappingKeyKeystore({
    innerKeystore: createPlainKeystore(),
    pinCode,
  });
}

function createLockedLocalKeyring(): LocalKeyring {
  return {
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
): LocalKeyring {
  function currentKeyring(): LocalKeyring {
    const keyring = resolveLocalKeyring();
    return keyring ?? createLockedLocalKeyring();
  }

  return {
    deleteSession: (scope) => currentKeyring().deleteSession(scope),
    getOrCreateSession: (scope) => currentKeyring().getOrCreateSession(scope),
    loadSession: (scope) => currentKeyring().loadSession(scope),
  };
}

export function createBrowserLocalKeyringForPinCode(
  pinCode: string | null,
): LocalKeyring {
  return pinCode
    ? createPinCodeBrowserLocalKeyring({ pinCode })
    : createBrowserLocalKeyring();
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

function sourceKeystoreForManifest(
  manifest: LocalKeyringManifest,
  pinCode: string | null,
): WrappingKeyKeystore {
  if (!isPinCodeWrappedLocalSecretEnvelope(manifest.rootKeyEnvelope)) {
    return createPlainKeystore();
  }
  if (!pinCode) {
    throw new Error("Current PIN code is required.");
  }

  return createPinKeystore(pinCode);
}

export async function rewrapExistingManifests(input: {
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

    await rewrapManifest({
      manifest,
      manifestStore: input.manifestStore,
      sourceKeystore: sourceKeystoreForManifest(manifest, input.sourcePinCode),
      targetKeystore: input.targetKeystore,
    });
  }
}

export async function verifyPinCode(input: {
  readonly manifestStore: LocalKeyringManifestStore;
  readonly pinCode: string;
  readonly scopes: readonly LocalKeyringScope[];
}): Promise<boolean> {
  const pinKeystore = createPinKeystore(input.pinCode);
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
}
