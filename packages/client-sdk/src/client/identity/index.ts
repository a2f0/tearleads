import {
  createIdentitySeedPhrase,
  type EncapsulationKeyPair,
  generateIdentityKeyPairsFromSeedPhrase,
  type SigningKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { errorMessage } from "../../data/shared/errorMessage";
import { createListenerSet } from "../runtime/listenerSet";
import {
  createIdentityKeyPackage,
  type IdentityKeyPackage,
  parseIdentityKeyPackage,
} from "./keyPackage";

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
  assertReadyForGeneration?: (() => void) | undefined;
  bootstrapLocalRootContainer?:
    | ((
        isCurrent: () => boolean,
      ) => Promise<{ containerId: string; created: boolean }>)
    | undefined;
  getUserId?: (() => string | null) | undefined;
}

export interface PreparedIdentityChange {
  isCurrent(): boolean;
  commit(): void;
}

/** Blobs prepares a store; tests use a no-op. Commit only assigns prepared state. */
interface IdentityChangePreparation {
  prepareIdentityChange(
    signingFingerprint: string | null,
  ): PreparedIdentityChange;
}

export function createIdentity(
  options: IdentityOptions = {},
  identityChanges: IdentityChangePreparation,
  log: (message: string) => void,
  runtimeHooks: IdentityRuntimeHooks = {},
): Identity {
  return new IdentityService(options, identityChanges, log, runtimeHooks);
}

class IdentityService implements Identity {
  private readonly listeners = createListenerSet();
  private snapshotValue: IdentitySnapshot;
  private changeRevision = 0;

  constructor(
    options: IdentityOptions = {},
    private readonly identityChanges: IdentityChangePreparation,
    private readonly log: (message: string) => void,
    private readonly runtimeHooks: IdentityRuntimeHooks,
  ) {
    this.snapshotValue = {
      encapsulationKeyPair: options.encapsulationKeyPair ?? null,
      seedPhrase: options.seedPhrase ?? null,
      signingFingerprint: options.signingFingerprint ?? null,
      signingKeyPair: options.signingKeyPair ?? null,
    };
    this.identityChanges
      .prepareIdentityChange(this.signingFingerprint)
      .commit();
  }

  get encapsulationKeyPair(): EncapsulationKeyPair | null {
    return this.snapshotValue.encapsulationKeyPair;
  }

  get seedPhrase(): string | null {
    return this.snapshotValue.seedPhrase;
  }

  get signingFingerprint(): string | null {
    return this.snapshotValue.signingFingerprint;
  }

  get signingKeyPair(): SigningKeyPair | null {
    return this.snapshotValue.signingKeyPair;
  }

  get snapshot(): IdentitySnapshot {
    return this.snapshotValue;
  }

  destroy(): void {
    const revision = ++this.changeRevision;
    this.publishSnapshot(
      {
        encapsulationKeyPair: null,
        seedPhrase: null,
        signingFingerprint: null,
        signingKeyPair: null,
      },
      revision,
    );
    this.log("Key pair destroyed");
  }

  exportKeyPackage(): Promise<IdentityKeyPackage> {
    return createIdentityKeyPackage(this.snapshot);
  }

  async generate(): Promise<IdentityGenerationResult> {
    const revision = ++this.changeRevision;
    this.runtimeHooks.assertReadyForGeneration?.();
    const seedPhrase = createIdentitySeedPhrase();
    const { encapsulationKeyPair, signingKeyPair } =
      generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
    const signingFingerprint = await toFingerprint(
      signingKeyPair.signingPublicKey,
    );
    // Factory failures must happen before persisting or selecting a local root.
    // Root failures leave the prepared store inactive and the identity unchanged.
    this.assertCurrent(revision);
    const prepared =
      this.identityChanges.prepareIdentityChange(signingFingerprint);
    this.assertCurrent(revision, prepared);
    const generationContext = await this.createGenerationContext(
      () => this.changeRevision === revision && prepared.isCurrent(),
    );
    this.publishSnapshot(
      { signingKeyPair, encapsulationKeyPair, seedPhrase, signingFingerprint },
      revision,
      prepared,
    );
    this.log("Key pair generated");
    return {
      ...this.snapshot,
      ...generationContext,
    };
  }

  async importKeyPackage(keyPackage: unknown): Promise<IdentitySnapshot> {
    const revision = ++this.changeRevision;
    const parsed = await parseIdentityKeyPackage(keyPackage);
    this.publishSnapshot(
      {
        encapsulationKeyPair: parsed.encapsulationKeyPair,
        seedPhrase: parsed.package.seedPhrase ?? null,
        signingKeyPair: parsed.signingKeyPair,
        signingFingerprint: parsed.package.signingFingerprint,
      },
      revision,
    );
    this.log("Key package imported");
    return this.snapshot;
  }

  async importSeedPhrase(seedPhrase: string): Promise<IdentitySnapshot> {
    const revision = ++this.changeRevision;
    const derived = generateIdentityKeyPairsFromSeedPhrase(seedPhrase);
    const signingFingerprint = await toFingerprint(
      derived.signingKeyPair.signingPublicKey,
    );
    this.publishSnapshot({ ...derived, signingFingerprint }, revision);
    this.log("Seed phrase imported");
    return this.snapshot;
  }

  requireSigningKeyPair(operation = "This operation"): SigningKeyPair {
    if (!this.signingKeyPair) {
      throw new Error(`${operation} requires a signing key pair.`);
    }

    return this.signingKeyPair;
  }

  async refreshSigningFingerprint(): Promise<string | null> {
    const revision = ++this.changeRevision;
    const snapshot = this.snapshot;
    const signingFingerprint = snapshot.signingKeyPair
      ? await toFingerprint(snapshot.signingKeyPair.signingPublicKey)
      : null;
    if (this.changeRevision !== revision) return this.signingFingerprint;
    this.publishSnapshot({ ...snapshot, signingFingerprint }, revision);
    return signingFingerprint;
  }

  async setKeyPairs(options: {
    encapsulationKeyPair: EncapsulationKeyPair | null;
    seedPhrase?: string | null | undefined;
    signingFingerprint?: string | null | undefined;
    signingKeyPair: SigningKeyPair | null;
  }): Promise<IdentitySnapshot> {
    const revision = ++this.changeRevision;
    const signingFingerprint =
      options.signingFingerprint ||
      (options.signingKeyPair
        ? await toFingerprint(options.signingKeyPair.signingPublicKey)
        : null);
    this.publishSnapshot(
      {
        encapsulationKeyPair: options.encapsulationKeyPair,
        seedPhrase: options.seedPhrase ?? null,
        signingKeyPair: options.signingKeyPair,
        signingFingerprint,
      },
      revision,
    );

    return this.snapshot;
  }

  subscribe = (listener: IdentityListener): (() => void) =>
    this.listeners.subscribe(listener);

  private async createGenerationContext(
    isCurrent: () => boolean,
  ): Promise<IdentityGenerationContext> {
    try {
      const bootstrapLocalRootContainer =
        this.runtimeHooks.bootstrapLocalRootContainer;
      if (!bootstrapLocalRootContainer) {
        throw new Error(
          "identity.generate requires local root container bootstrap.",
        );
      }

      const rootContainer = await bootstrapLocalRootContainer(isCurrent);

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

  private publishSnapshot(
    nextSnapshot: IdentitySnapshot,
    revision: number,
    prepared?: PreparedIdentityChange,
  ): void {
    this.assertCurrent(revision, prepared);
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

    const change =
      prepared ??
      this.identityChanges.prepareIdentityChange(
        nextSnapshot.signingFingerprint,
      );
    this.assertCurrent(revision, change);
    change.commit();
    this.snapshotValue = nextSnapshot;
    this.listeners.notify();
  }

  private assertCurrent(
    revision: number,
    prepared?: PreparedIdentityChange,
  ): void {
    if (this.changeRevision !== revision || prepared?.isCurrent() === false) {
      throw new Error("Identity change was superseded.");
    }
  }
}
