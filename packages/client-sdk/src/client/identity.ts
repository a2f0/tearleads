import {
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type SigningKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createIdentityKeyPackage,
  type IdentityKeyPackage,
  parseIdentityKeyPackage,
} from "./identityKeyPackage";

export interface IdentityOptions {
  encapsulationKeyPair?: EncapsulationKeyPair | null | undefined;
  signingFingerprint?: string | null | undefined;
  signingKeyPair?: SigningKeyPair | null | undefined;
}

export interface IdentitySnapshot {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

export interface IdentityGenerationResult extends IdentitySnapshot {
  rootContainerCreated: boolean | null;
  rootContainerId: string | null;
  userId: string | null;
}

export type IdentityListener = () => void;

export interface Identity {
  readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: SigningKeyPair | null;
  readonly snapshot: IdentitySnapshot;
  destroy(): void;
  exportKeyPackage(): Promise<IdentityKeyPackage>;
  generate(): Promise<IdentityGenerationResult>;
  importKeyPackage(keyPackage: unknown): Promise<IdentitySnapshot>;
  requireSigningKeyPair(operation?: string): SigningKeyPair;
  refreshSigningFingerprint(): Promise<string | null>;
  setKeyPairs(options: {
    encapsulationKeyPair: EncapsulationKeyPair | null;
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<IdentitySnapshot>;
  subscribe(listener: IdentityListener): () => void;
}

interface IdentityGenerationContext {
  rootContainerCreated: boolean | null;
  rootContainerId: string | null;
  userId: string | null;
}

interface IdentityRuntimeHooks {
  bootstrapLocalRootContainer?:
    | (() => Promise<{ containerId: string; created: boolean } | null>)
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
    this.signingFingerprintValue = options.signingFingerprint ?? null;
    this.signingKeyPairValue = options.signingKeyPair ?? null;
    this.snapshotValue = this.createSnapshot();
    this.onIdentityChanged(this.signingFingerprintValue);
  }

  get encapsulationKeyPair(): EncapsulationKeyPair | null {
    return this.encapsulationKeyPairValue;
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
    this.signingFingerprintValue = null;
    this.signingKeyPairValue = null;
    this.publishSnapshot();
    this.log("Key pair destroyed");
  }

  exportKeyPackage(): Promise<IdentityKeyPackage> {
    return createIdentityKeyPackage(this.snapshot);
  }

  async generate(): Promise<IdentityGenerationResult> {
    this.signingKeyPairValue = generateSigningSeedAndKeyPair();
    this.encapsulationKeyPairValue = generateKemSeedAndKeyPair();
    await this.refreshSigningFingerprint();
    this.log("Key pair generated");
    return {
      ...this.snapshot,
      ...(await this.createGenerationContext()),
    };
  }

  async importKeyPackage(keyPackage: unknown): Promise<IdentitySnapshot> {
    const parsed = await parseIdentityKeyPackage(keyPackage);
    this.encapsulationKeyPairValue = parsed.encapsulationKeyPair;
    this.signingKeyPairValue = parsed.signingKeyPair;
    this.signingFingerprintValue = parsed.package.signingFingerprint;
    this.publishSnapshot();
    this.log("Key package imported");
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
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<IdentitySnapshot> {
    this.encapsulationKeyPairValue = options.encapsulationKeyPair;
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
      signingFingerprint: this.signingFingerprintValue,
      signingKeyPair: this.signingKeyPairValue,
    };
  }

  private async createGenerationContext(): Promise<IdentityGenerationContext> {
    let rootContainer: { containerId: string; created: boolean } | null = null;
    if (this.runtimeHooks.bootstrapLocalRootContainer) {
      try {
        rootContainer = await this.runtimeHooks.bootstrapLocalRootContainer();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`Root container bootstrap failed: ${message}`);
      }
    }

    return {
      rootContainerCreated: rootContainer?.created ?? null,
      rootContainerId: rootContainer?.containerId ?? null,
      userId: this.runtimeHooks.getUserId?.() ?? null,
    };
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
