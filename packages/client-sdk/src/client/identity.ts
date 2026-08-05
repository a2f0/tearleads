import {
  createIdentitySeedPhrase,
  type EncapsulationKeyPair,
  generateIdentityKeyPairsFromSeedPhrase,
  type SigningKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { errorMessage } from "../data/errorMessage";
import {
  createIdentityKeyPackage,
  type IdentityKeyPackage,
  parseIdentityKeyPackage,
} from "./identityKeyPackage";

export interface IdentityOptions {
  encapsulationKeyPair?: EncapsulationKeyPair | null | undefined;
  seedPhrase?: string | null | undefined;
  signingFingerprint?: string | null | undefined;
  signingKeyPair?: SigningKeyPair | null | undefined;
}

export interface IdentitySnapshot {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  seedPhrase: string | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

export interface IdentityGenerationResult extends IdentitySnapshot {
  rootContainerCreated: boolean;
  rootContainerId: string;
  userId: string | null;
}

export type IdentityListener = () => void;

export interface Identity {
  readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  readonly seedPhrase: string | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: SigningKeyPair | null;
  readonly snapshot: IdentitySnapshot;
  destroy(): void;
  exportKeyPackage(): Promise<IdentityKeyPackage>;
  generate(): Promise<IdentityGenerationResult>;
  importKeyPackage(keyPackage: unknown): Promise<IdentitySnapshot>;
  importSeedPhrase(seedPhrase: string): Promise<IdentitySnapshot>;
  requireSigningKeyPair(operation?: string): SigningKeyPair;
  refreshSigningFingerprint(): Promise<string | null>;
  setKeyPairs(options: {
    encapsulationKeyPair: EncapsulationKeyPair | null;
    seedPhrase?: string | null | undefined;
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<IdentitySnapshot>;
  subscribe(listener: IdentityListener): () => void;
}

interface IdentityGenerationContext {
  rootContainerCreated: boolean;
  rootContainerId: string;
  userId: string | null;
}

interface IdentityRuntimeHooks {
  bootstrapLocalRootContainer?:
    | (() => Promise<{ containerId: string; created: boolean }>)
    | undefined;
  getUserId?: (() => string | null) | undefined;
}

export function createIdentity(
  options: IdentityOptions = {},
  onIdentityChanged: (signingFingerprint: string | null) => void,
  log: (message: string) => void,
  runtimeHooks: IdentityRuntimeHooks = {},
): Identity {
  return new IdentityService(options, onIdentityChanged, log, runtimeHooks);
}

class IdentityService implements Identity {
  private encapsulationKeyPairValue: EncapsulationKeyPair | null;
  private readonly listeners = new Set<IdentityListener>();
  private seedPhraseValue: string | null;
  private signingFingerprintValue: string | null;
  private signingKeyPairValue: SigningKeyPair | null;
  private snapshotValue: IdentitySnapshot;

  constructor(
    options: IdentityOptions = {},
    private readonly onIdentityChanged: (
      signingFingerprint: string | null,
    ) => void,
    private readonly log: (message: string) => void,
    private readonly runtimeHooks: IdentityRuntimeHooks,
  ) {
    this.encapsulationKeyPairValue = options.encapsulationKeyPair ?? null;
    this.seedPhraseValue = options.seedPhrase ?? null;
    this.signingFingerprintValue = options.signingFingerprint ?? null;
    this.signingKeyPairValue = options.signingKeyPair ?? null;
    this.snapshotValue = this.createSnapshot();
    this.onIdentityChanged(this.signingFingerprintValue);
  }

  get encapsulationKeyPair(): EncapsulationKeyPair | null {
    return this.encapsulationKeyPairValue;
  }

  get seedPhrase(): string | null {
    return this.seedPhraseValue;
  }

  get signingFingerprint(): string | null {
    return this.signingFingerprintValue;
  }

  get signingKeyPair(): SigningKeyPair | null {
    return this.signingKeyPairValue;
  }

  get snapshot(): IdentitySnapshot {
    return this.snapshotValue;
  }

  destroy(): void {
    this.encapsulationKeyPairValue = null;
    this.seedPhraseValue = null;
    this.signingFingerprintValue = null;
    this.signingKeyPairValue = null;
    this.publishSnapshot();
    this.log("Key pair destroyed");
  }

  exportKeyPackage(): Promise<IdentityKeyPackage> {
    return createIdentityKeyPackage(this.snapshot);
  }

  async generate(): Promise<IdentityGenerationResult> {
    const seedPhrase = createIdentitySeedPhrase();
    const { encapsulationKeyPair, signingKeyPair } =
      generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
    const signingFingerprint = await toFingerprint(
      signingKeyPair.signingPublicKey,
    );
    const generationContext = await this.createGenerationContext();

    this.signingKeyPairValue = signingKeyPair;
    this.encapsulationKeyPairValue = encapsulationKeyPair;
    this.seedPhraseValue = seedPhrase;
    this.signingFingerprintValue = signingFingerprint;
    this.publishSnapshot();
    this.log("Key pair generated");
    return {
      ...this.snapshot,
      ...generationContext,
    };
  }

  async importKeyPackage(keyPackage: unknown): Promise<IdentitySnapshot> {
    const parsed = await parseIdentityKeyPackage(keyPackage);
    this.encapsulationKeyPairValue = parsed.encapsulationKeyPair;
    this.seedPhraseValue = parsed.package.seedPhrase ?? null;
    this.signingKeyPairValue = parsed.signingKeyPair;
    this.signingFingerprintValue = parsed.package.signingFingerprint;
    this.publishSnapshot();
    this.log("Key package imported");
    return this.snapshot;
  }

  async importSeedPhrase(seedPhrase: string): Promise<IdentitySnapshot> {
    const derived = generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
    this.encapsulationKeyPairValue = derived.encapsulationKeyPair;
    this.seedPhraseValue = derived.seedPhrase;
    this.signingKeyPairValue = derived.signingKeyPair;
    this.signingFingerprintValue = await toFingerprint(
      derived.signingKeyPair.signingPublicKey,
    );
    this.publishSnapshot();
    this.log("Seed phrase imported");
    return this.snapshot;
  }

  requireSigningKeyPair(operation = "This operation"): SigningKeyPair {
    if (!this.signingKeyPairValue) {
      throw new Error(`${operation} requires a signing key pair.`);
    }

    return this.signingKeyPairValue;
  }

  async refreshSigningFingerprint(): Promise<string | null> {
    if (!this.signingKeyPairValue) {
      this.signingFingerprintValue = null;
      this.publishSnapshot();
      return null;
    }

    this.signingFingerprintValue = await toFingerprint(
      this.signingKeyPairValue.signingPublicKey,
    );
    this.publishSnapshot();
    return this.signingFingerprintValue;
  }

  async setKeyPairs(options: {
    encapsulationKeyPair: EncapsulationKeyPair | null;
    seedPhrase?: string | null | undefined;
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<IdentitySnapshot> {
    this.encapsulationKeyPairValue = options.encapsulationKeyPair;
    this.seedPhraseValue = options.seedPhrase ?? null;
    this.signingKeyPairValue = options.signingKeyPair;
    this.signingFingerprintValue = options.signingFingerprint ?? null;

    if (!this.signingFingerprintValue) {
      await this.refreshSigningFingerprint();
    } else {
      this.publishSnapshot();
    }

    return this.snapshot;
  }

  subscribe = (listener: IdentityListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private createSnapshot(): IdentitySnapshot {
    return {
      encapsulationKeyPair: this.encapsulationKeyPairValue,
      seedPhrase: this.seedPhraseValue,
      signingFingerprint: this.signingFingerprintValue,
      signingKeyPair: this.signingKeyPairValue,
    };
  }

  private async createGenerationContext(): Promise<IdentityGenerationContext> {
    try {
      const bootstrapLocalRootContainer =
        this.runtimeHooks.bootstrapLocalRootContainer;
      if (!bootstrapLocalRootContainer) {
        throw new Error(
          "identity.generate requires local root container bootstrap.",
        );
      }

      const rootContainer = await bootstrapLocalRootContainer();

      return {
        rootContainerCreated: rootContainer.created,
        rootContainerId: rootContainer.containerId,
        userId: this.runtimeHooks.getUserId?.() ?? null,
      };
    } catch (error: unknown) {
      const message = errorMessage(error);
      this.log(`Root container bootstrap failed: ${message}`);
      throw error;
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  }

  private publishSnapshot(): void {
    const nextSnapshot = this.createSnapshot();
    const previousSnapshot = this.snapshotValue;
    if (
      previousSnapshot.encapsulationKeyPair ===
        nextSnapshot.encapsulationKeyPair &&
      previousSnapshot.seedPhrase === nextSnapshot.seedPhrase &&
      previousSnapshot.signingFingerprint === nextSnapshot.signingFingerprint &&
      previousSnapshot.signingKeyPair === nextSnapshot.signingKeyPair
    ) {
      return;
    }

    this.snapshotValue = nextSnapshot;
    this.onIdentityChanged(nextSnapshot.signingFingerprint);
    this.notifyListeners();
  }
}
