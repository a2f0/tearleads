import {
  type EncapsulationKeyPair,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type SigningKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createIdentityKeyPackage,
  parseIdentityKeyPackage,
  type TearleadsIdentityKeyPackage,
} from "./identityKeyPackage";

export interface TearleadsIdentityOptions {
  encapsulationKeyPair?: EncapsulationKeyPair | null | undefined;
  signingFingerprint?: string | null | undefined;
  signingKeyPair?: SigningKeyPair | null | undefined;
}

export interface TearleadsIdentitySnapshot {
  encapsulationKeyPair: EncapsulationKeyPair | null;
  signingFingerprint: string | null;
  signingKeyPair: SigningKeyPair | null;
}

export interface TearleadsIdentity {
  readonly encapsulationKeyPair: EncapsulationKeyPair | null;
  readonly signingFingerprint: string | null;
  readonly signingKeyPair: SigningKeyPair | null;
  readonly snapshot: TearleadsIdentitySnapshot;
  destroy(): void;
  exportKeyPackage(): Promise<TearleadsIdentityKeyPackage>;
  generate(): Promise<TearleadsIdentitySnapshot>;
  importKeyPackage(keyPackage: unknown): Promise<TearleadsIdentitySnapshot>;
  requireSigningKeyPair(operation?: string): SigningKeyPair;
  refreshSigningFingerprint(): Promise<string | null>;
  setKeyPairs(options: {
    encapsulationKeyPair: EncapsulationKeyPair | null;
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<TearleadsIdentitySnapshot>;
}

export function createTearleadsIdentity(
  options: TearleadsIdentityOptions = {},
  onIdentityChanged: (signingFingerprint: string | null) => void,
  log: (message: string) => void,
): TearleadsIdentity {
  return new TearleadsIdentityService(options, onIdentityChanged, log);
}

class TearleadsIdentityService implements TearleadsIdentity {
  private encapsulationKeyPairValue: EncapsulationKeyPair | null;
  private signingFingerprintValue: string | null;
  private signingKeyPairValue: SigningKeyPair | null;

  constructor(
    options: TearleadsIdentityOptions = {},
    private readonly onIdentityChanged: (
      signingFingerprint: string | null,
    ) => void,
    private readonly log: (message: string) => void,
  ) {
    this.encapsulationKeyPairValue = options.encapsulationKeyPair ?? null;
    this.signingFingerprintValue = options.signingFingerprint ?? null;
    this.signingKeyPairValue = options.signingKeyPair ?? null;
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

  get snapshot(): TearleadsIdentitySnapshot {
    return {
      encapsulationKeyPair: this.encapsulationKeyPairValue,
      signingFingerprint: this.signingFingerprintValue,
      signingKeyPair: this.signingKeyPairValue,
    };
  }

  destroy(): void {
    this.encapsulationKeyPairValue = null;
    this.signingFingerprintValue = null;
    this.signingKeyPairValue = null;
    this.onIdentityChanged(null);
    this.log("Key pair destroyed");
  }

  exportKeyPackage(): Promise<TearleadsIdentityKeyPackage> {
    return createIdentityKeyPackage(this.snapshot);
  }

  async generate(): Promise<TearleadsIdentitySnapshot> {
    this.signingKeyPairValue = generateSigningSeedAndKeyPair();
    this.encapsulationKeyPairValue = generateKemSeedAndKeyPair();
    await this.refreshSigningFingerprint();
    this.log("Key pair generated");
    return this.snapshot;
  }

  async importKeyPackage(
    keyPackage: unknown,
  ): Promise<TearleadsIdentitySnapshot> {
    const parsed = await parseIdentityKeyPackage(keyPackage);
    this.encapsulationKeyPairValue = parsed.encapsulationKeyPair;
    this.signingKeyPairValue = parsed.signingKeyPair;
    this.signingFingerprintValue = parsed.package.signingFingerprint;
    this.onIdentityChanged(this.signingFingerprintValue);
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
      this.onIdentityChanged(null);
      return null;
    }

    this.signingFingerprintValue = await toFingerprint(
      this.signingKeyPairValue.signingPublicKey,
    );
    this.onIdentityChanged(this.signingFingerprintValue);
    return this.signingFingerprintValue;
  }

  async setKeyPairs(options: {
    encapsulationKeyPair: EncapsulationKeyPair | null;
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<TearleadsIdentitySnapshot> {
    this.encapsulationKeyPairValue = options.encapsulationKeyPair;
    this.signingKeyPairValue = options.signingKeyPair;
    this.signingFingerprintValue = options.signingFingerprint ?? null;

    if (!this.signingFingerprintValue) {
      await this.refreshSigningFingerprint();
    } else {
      this.onIdentityChanged(this.signingFingerprintValue);
    }

    return this.snapshot;
  }
}
