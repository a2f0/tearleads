import type { DatabaseSession } from "@tearleads/api-shared/postgres";

export interface ContentKeyBundle<TTarget> {
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly TTarget[];
}

export interface ContentKeyStoreInput<TTarget> {
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly TTarget[];
}

interface StorePreparationInput<TInput, TBundle, TCurrentTargets> {
  readonly currentTargets: TCurrentTargets;
  readonly input: TInput;
  readonly latestBundle: TBundle | null;
}

interface ReconcileBundleInput<TInput, TBundle, TCurrentTargets, TPreparation>
  extends StorePreparationInput<TInput, TBundle, TCurrentTargets> {
  readonly existingBundle: TBundle;
  readonly executor: DatabaseSession;
  readonly preparation: TPreparation;
}

export interface ContentKeyEpochRow {
  readonly contentKeyEpoch: number;
  readonly id: string;
}

export interface CreateContentKeyStoreOptions<
  TTarget,
  TInput extends ContentKeyStoreInput<TTarget>,
  TEpochRow extends ContentKeyEpochRow,
  TBundle extends ContentKeyBundle<TTarget>,
  TCurrentTargets,
  TPreparation,
> {
  readonly createBundleConflictError: () => Error;
  readonly createMissingEpochError: () => Error;
  readonly getIdentifier: (input: TInput) => string;
  readonly insertEpochRow: (
    input: TInput,
    executor: DatabaseSession,
  ) => Promise<TEpochRow | null>;
  readonly insertTargets: (
    epochId: string,
    targets: readonly TTarget[],
    executor: DatabaseSession,
  ) => Promise<void>;
  readonly loadEpochRow: (
    identifier: string,
    contentKeyEpoch: number,
    executor: DatabaseSession,
  ) => Promise<TEpochRow | null>;
  readonly loadLatestEpochRow: (
    identifier: string,
    executor: DatabaseSession,
  ) => Promise<TEpochRow | null>;
  readonly prepareStore: (
    input: StorePreparationInput<TInput, TBundle, TCurrentTargets>,
  ) => TPreparation;
  readonly reconcileExistingBundle: (
    input: ReconcileBundleInput<TInput, TBundle, TCurrentTargets, TPreparation>,
  ) => Promise<TBundle>;
  readonly refreshExistingBundleMetadata: (input: {
    readonly existingBundle: TBundle;
    readonly executor: DatabaseSession;
    readonly nextBundle: TInput;
  }) => Promise<TBundle>;
  readonly sortTargetEnvelopes: (
    targets: readonly TTarget[],
  ) => readonly TTarget[];
  readonly targetEnvelopeEqual: (left: TTarget, right: TTarget) => boolean;
  readonly toStoredBundle: (
    row: TEpochRow,
    executor: DatabaseSession,
  ) => Promise<TBundle>;
  readonly validateCurrentTargets: (
    input: TInput,
    executor: DatabaseSession,
  ) => Promise<TCurrentTargets>;
}
