import {
  IDENTITY_KEY_PACKAGE_FORMAT,
  type IdentityKeyPackage,
  type LocalKeyring,
  type LocalKeyringScope,
} from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  decryptLocalIdentityPayload,
  encryptLocalIdentityPayload,
} from "./localIdentityPackageCrypto";

const LOCAL_IDENTITY_REGISTRY_FORMAT = "tearleads.app.local-identity-registry";

export type LocalIdentityStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export interface LocalIdentitySummary {
  readonly addedAt: string;
  readonly signingFingerprint: string;
}

interface StoredLocalIdentity extends LocalIdentitySummary {
  readonly keyPackage: IdentityKeyPackage;
}

interface LocalIdentityRegistry {
  readonly activeSigningFingerprint: string | null;
  readonly format: typeof LOCAL_IDENTITY_REGISTRY_FORMAT;
  readonly identities: readonly StoredLocalIdentity[];
  readonly version: 1;
}

interface LocalIdentityRepositoryOptions {
  readonly keyring: LocalKeyring;
  readonly scope: LocalKeyringScope;
  readonly storage: LocalIdentityStorage;
  readonly storageKey: string;
}

const EMPTY_REGISTRY: LocalIdentityRegistry = {
  activeSigningFingerprint: null,
  format: LOCAL_IDENTITY_REGISTRY_FORMAT,
  identities: [],
  version: 1,
};

function readRequiredString(
  value: object,
  property: string,
  label: string,
): string {
  const propertyValue = Reflect.get(value, property);
  if (typeof propertyValue !== "string" || propertyValue.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return propertyValue;
}

function readIdentityKeyPackage(value: unknown): IdentityKeyPackage {
  if (
    !isPlainObject(value) ||
    Reflect.get(value, "format") !== IDENTITY_KEY_PACKAGE_FORMAT ||
    Reflect.get(value, "version") !== 1
  ) {
    throw new Error("Local identity registry contains an invalid key package.");
  }

  const encapsulationKeyPair = Reflect.get(value, "encapsulationKeyPair");
  const signingKeyPair = Reflect.get(value, "signingKeyPair");
  if (!isPlainObject(encapsulationKeyPair) || !isPlainObject(signingKeyPair)) {
    throw new Error("Local identity registry key pairs are invalid.");
  }
  const seedPhrase = Reflect.get(value, "seedPhrase");
  if (seedPhrase !== undefined && typeof seedPhrase !== "string") {
    throw new Error("Local identity registry seed phrase is invalid.");
  }

  return {
    createdAt: readRequiredString(
      value,
      "createdAt",
      "Identity key package createdAt",
    ),
    encapsulationKeyPair: {
      publicKey: readRequiredString(
        encapsulationKeyPair,
        "publicKey",
        "Identity encapsulation public key",
      ),
      secretKey: readRequiredString(
        encapsulationKeyPair,
        "secretKey",
        "Identity encapsulation secret key",
      ),
    },
    format: IDENTITY_KEY_PACKAGE_FORMAT,
    ...(seedPhrase ? { seedPhrase } : {}),
    signingFingerprint: readRequiredString(
      value,
      "signingFingerprint",
      "Identity key package signingFingerprint",
    ),
    signingKeyPair: {
      signingPrivateKey: readRequiredString(
        signingKeyPair,
        "signingPrivateKey",
        "Identity signing private key",
      ),
      signingPublicKey: readRequiredString(
        signingKeyPair,
        "signingPublicKey",
        "Identity signing public key",
      ),
    },
    version: 1,
  };
}

function readStoredIdentity(value: unknown): StoredLocalIdentity {
  if (!isPlainObject(value)) {
    throw new Error("Local identity registry entry must be an object.");
  }

  const keyPackage = readIdentityKeyPackage(Reflect.get(value, "keyPackage"));
  const signingFingerprint = readRequiredString(
    value,
    "signingFingerprint",
    "Local identity signingFingerprint",
  );
  if (keyPackage.signingFingerprint !== signingFingerprint) {
    throw new Error(
      "Local identity registry fingerprint does not match its key package.",
    );
  }

  return {
    addedAt: readRequiredString(value, "addedAt", "Local identity addedAt"),
    keyPackage,
    signingFingerprint,
  };
}

function readRegistryPayload(value: unknown): LocalIdentityRegistry {
  if (
    !isPlainObject(value) ||
    Reflect.get(value, "format") !== LOCAL_IDENTITY_REGISTRY_FORMAT ||
    Reflect.get(value, "version") !== 1
  ) {
    throw new Error("Local identity registry format is unsupported.");
  }

  const rawActiveSigningFingerprint = Reflect.get(
    value,
    "activeSigningFingerprint",
  );
  if (
    rawActiveSigningFingerprint !== null &&
    typeof rawActiveSigningFingerprint !== "string"
  ) {
    throw new Error("Local identity registry active fingerprint is invalid.");
  }
  const rawIdentities = Reflect.get(value, "identities");
  if (!Array.isArray(rawIdentities)) {
    throw new Error("Local identity registry identities must be an array.");
  }
  const identities = rawIdentities.map(readStoredIdentity);
  const fingerprints = new Set(
    identities.map((identity) => identity.signingFingerprint),
  );
  if (fingerprints.size !== identities.length) {
    throw new Error("Local identity registry contains duplicate identities.");
  }
  const activeSigningFingerprint = rawActiveSigningFingerprint;
  if (
    activeSigningFingerprint !== null &&
    !fingerprints.has(activeSigningFingerprint)
  ) {
    throw new Error("Local identity registry active identity is missing.");
  }

  return {
    activeSigningFingerprint,
    format: LOCAL_IDENTITY_REGISTRY_FORMAT,
    identities,
    version: 1,
  };
}

function summaries(
  registry: LocalIdentityRegistry,
): readonly LocalIdentitySummary[] {
  return registry.identities.map(({ addedAt, signingFingerprint }) => ({
    addedAt,
    signingFingerprint,
  }));
}

/**
 * Serialized, encrypted storage for every identity saved in one app-runtime
 * namespace. All records deliberately share one local-keyring scope so the
 * browser PIN wraps one keychain root while SQLite and blob data remain scoped
 * by each signing fingerprint.
 */
export class LocalIdentityRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: LocalIdentityRepositoryOptions) {}

  load(): Promise<{
    readonly activeKeyPackage: IdentityKeyPackage | null;
    readonly activeSigningFingerprint: string | null;
    readonly identities: readonly LocalIdentitySummary[];
  }> {
    return this.enqueue(async () => {
      const registry = await this.readRegistry();
      const activeIdentity = registry.identities.find(
        (identity) =>
          identity.signingFingerprint === registry.activeSigningFingerprint,
      );
      return {
        activeKeyPackage: activeIdentity?.keyPackage ?? null,
        activeSigningFingerprint: registry.activeSigningFingerprint,
        identities: summaries(registry),
      };
    });
  }

  findKeyPackage(
    signingFingerprint: string,
  ): Promise<IdentityKeyPackage | null> {
    return this.enqueue(async () => {
      const registry = await this.readRegistry();
      return (
        registry.identities.find(
          (identity) => identity.signingFingerprint === signingFingerprint,
        )?.keyPackage ?? null
      );
    });
  }

  setActive(
    signingFingerprint: string,
  ): Promise<readonly LocalIdentitySummary[]> {
    return this.enqueue(async () => {
      const registry = await this.readRegistry();
      if (
        !registry.identities.some(
          (identity) => identity.signingFingerprint === signingFingerprint,
        )
      ) {
        throw new Error("Selected local identity was not found.");
      }
      const nextRegistry = {
        ...registry,
        activeSigningFingerprint: signingFingerprint,
      };
      await this.writeRegistry(nextRegistry);
      return summaries(nextRegistry);
    });
  }

  upsert(
    keyPackage: IdentityKeyPackage,
  ): Promise<readonly LocalIdentitySummary[]> {
    return this.enqueue(async () => {
      const registry = await this.readRegistry();
      const existingIndex = registry.identities.findIndex(
        (identity) =>
          identity.signingFingerprint === keyPackage.signingFingerprint,
      );
      const nextIdentity: StoredLocalIdentity = {
        addedAt:
          existingIndex === -1
            ? keyPackage.createdAt
            : (registry.identities[existingIndex]?.addedAt ??
              keyPackage.createdAt),
        keyPackage,
        signingFingerprint: keyPackage.signingFingerprint,
      };
      const identities = [...registry.identities];
      if (existingIndex === -1) {
        identities.push(nextIdentity);
      } else {
        identities[existingIndex] = nextIdentity;
      }
      const nextRegistry: LocalIdentityRegistry = {
        ...registry,
        activeSigningFingerprint: keyPackage.signingFingerprint,
        identities,
      };
      await this.writeRegistry(nextRegistry);
      return summaries(nextRegistry);
    });
  }

  remove(signingFingerprint: string): Promise<readonly LocalIdentitySummary[]> {
    return this.enqueue(async () => {
      const registry = await this.readRegistry();
      const identities = registry.identities.filter(
        (identity) => identity.signingFingerprint !== signingFingerprint,
      );
      if (identities.length === 0) {
        this.options.storage.removeItem(this.options.storageKey);
        await this.options.keyring.deleteSession(this.options.scope);
        return [];
      }

      const nextRegistry: LocalIdentityRegistry = {
        ...registry,
        activeSigningFingerprint:
          registry.activeSigningFingerprint === signingFingerprint
            ? (identities[0]?.signingFingerprint ?? null)
            : registry.activeSigningFingerprint,
        identities,
      };
      await this.writeRegistry(nextRegistry);
      return summaries(nextRegistry);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readRegistry(): Promise<LocalIdentityRegistry> {
    const serializedEnvelope = this.options.storage.getItem(
      this.options.storageKey,
    );
    if (!serializedEnvelope) {
      return EMPTY_REGISTRY;
    }

    const session = await this.options.keyring.loadSession(this.options.scope);
    if (!session) {
      return EMPTY_REGISTRY;
    }
    try {
      const payload = await decryptLocalIdentityPayload({
        identityPersistenceKey: session.identityPersistenceKey,
        serializedEnvelope,
      });
      return readRegistryPayload(payload);
    } finally {
      session.dispose();
    }
  }

  private async writeRegistry(registry: LocalIdentityRegistry): Promise<void> {
    const session = await this.options.keyring.getOrCreateSession(
      this.options.scope,
    );
    try {
      const serializedEnvelope = await encryptLocalIdentityPayload({
        identityPersistenceKey: session.identityPersistenceKey,
        payload: registry,
      });
      this.options.storage.setItem(this.options.storageKey, serializedEnvelope);
    } finally {
      session.dispose();
    }
  }
}
