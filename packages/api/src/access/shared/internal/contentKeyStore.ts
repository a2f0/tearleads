import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import type { WriteHeader } from "@symcrypt/crypto";
import { targetEnvelopeBundlesEqual } from "./targetEnvelopeBundles";

interface ContentKeyBundle<TTarget> {
  readonly contentKeyEpoch: number;
  readonly targetHash: string;
  readonly targets: readonly TTarget[];
}

interface ContentKeyStoreInput<TTarget> {
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

interface ContentKeyEpochRow {
  readonly contentKeyEpoch: number;
  readonly id: string;
}

interface CreateContentKeyStoreOptions<
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

class ContentKeyStore<
  TTarget,
  TInput extends ContentKeyStoreInput<TTarget>,
  TEpochRow extends ContentKeyEpochRow,
  TBundle extends ContentKeyBundle<TTarget>,
  TCurrentTargets,
  TPreparation,
> {
  constructor(
    private readonly options: CreateContentKeyStoreOptions<
      TTarget,
      TInput,
      TEpochRow,
      TBundle,
      TCurrentTargets,
      TPreparation
    >,
  ) {}

  async getBundle(
    identifier: string,
    contentKeyEpoch: number,
    executor: DatabaseSession,
  ): Promise<TBundle | null> {
    const row = await this.options.loadEpochRow(
      identifier,
      contentKeyEpoch,
      executor,
    );
    return row ? this.options.toStoredBundle(row, executor) : null;
  }

  async getLatestBundle(
    identifier: string,
    executor: DatabaseSession,
  ): Promise<TBundle | null> {
    const row = await this.options.loadLatestEpochRow(identifier, executor);
    return row ? this.options.toStoredBundle(row, executor) : null;
  }

  async getLatestContentKeyEpoch(
    identifier: string,
    executor: DatabaseSession,
  ): Promise<number | null> {
    const row = await this.options.loadLatestEpochRow(identifier, executor);
    return row?.contentKeyEpoch ?? null;
  }

  private async createBundle(
    input: TInput,
    executor: DatabaseSession,
  ): Promise<TBundle> {
    const identifier = this.options.getIdentifier(input);
    const epochRow =
      (await this.options.insertEpochRow(input, executor)) ??
      (await this.options.loadEpochRow(
        identifier,
        input.contentKeyEpoch,
        executor,
      ));
    if (!epochRow) {
      throw this.options.createMissingEpochError();
    }

    await this.options.insertTargets(epochRow.id, input.targets, executor);
    const storedBundle = await this.options.toStoredBundle(epochRow, executor);
    if (
      !targetEnvelopeBundlesEqual(
        storedBundle.targets,
        input.targets,
        this.options.sortTargetEnvelopes,
        this.options.targetEnvelopeEqual,
      )
    ) {
      throw this.options.createBundleConflictError();
    }

    return storedBundle;
  }

  async storeInTransaction(
    input: TInput,
    executor: DatabaseTransaction,
  ): Promise<TBundle & { readonly currentTargets: TCurrentTargets }> {
    const currentTargets = await this.options.validateCurrentTargets(
      input,
      executor,
    );
    const identifier = this.options.getIdentifier(input);
    const latestBundle = await this.getLatestBundle(identifier, executor);
    const preparation = this.options.prepareStore({
      currentTargets,
      input,
      latestBundle,
    });
    const existingBundle = await this.getBundle(
      identifier,
      input.contentKeyEpoch,
      executor,
    );

    let bundle: TBundle;
    if (!existingBundle) {
      bundle = await this.createBundle(input, executor);
    } else if (
      targetEnvelopeBundlesEqual(
        existingBundle.targets,
        input.targets,
        this.options.sortTargetEnvelopes,
        this.options.targetEnvelopeEqual,
      )
    ) {
      bundle = await this.options.refreshExistingBundleMetadata({
        existingBundle,
        nextBundle: input,
        executor,
      });
    } else {
      bundle = await this.options.reconcileExistingBundle({
        currentTargets,
        existingBundle,
        executor,
        input,
        latestBundle,
        preparation,
      });
    }

    return { ...bundle, currentTargets };
  }

  store(
    input: TInput,
    database: ApiDatabase,
  ): Promise<TBundle & { readonly currentTargets: TCurrentTargets }> {
    return database.transaction((tx) => this.storeInTransaction(input, tx));
  }
}

export function createContentKeyStore<
  TTarget,
  TInput extends ContentKeyStoreInput<TTarget>,
  TEpochRow extends ContentKeyEpochRow,
  TBundle extends ContentKeyBundle<TTarget>,
  TCurrentTargets,
  TPreparation,
>(
  options: CreateContentKeyStoreOptions<
    TTarget,
    TInput,
    TEpochRow,
    TBundle,
    TCurrentTargets,
    TPreparation
  >,
) {
  return new ContentKeyStore(options);
}

export function carryForwardContentKeyTargets<
  TCurrentTarget,
  TEnvelope,
>(input: {
  readonly currentTargets: readonly TCurrentTarget[];
  readonly previousTargets: readonly TEnvelope[];
  readonly requireSameTargetCount?: boolean | undefined;
  readonly sortTargetEnvelopes: (targets: readonly TEnvelope[]) => TEnvelope[];
  readonly targetKey: (target: TCurrentTarget | TEnvelope) => string;
  readonly targetKeyMaterialEqual: (
    previous: TEnvelope,
    current: TCurrentTarget,
  ) => boolean;
  readonly toEnvelope: (
    current: TCurrentTarget,
    previous: TEnvelope,
  ) => TEnvelope;
}): TEnvelope[] | null {
  const previousByTargetKey = new Map(
    input.previousTargets.map((target) => [input.targetKey(target), target]),
  );
  if (
    input.requireSameTargetCount &&
    previousByTargetKey.size !== input.currentTargets.length
  ) {
    return null;
  }

  const targets: TEnvelope[] = [];
  for (const currentTarget of input.currentTargets) {
    const previousTarget = previousByTargetKey.get(
      input.targetKey(currentTarget),
    );
    if (
      !previousTarget ||
      !input.targetKeyMaterialEqual(previousTarget, currentTarget)
    ) {
      return null;
    }
    targets.push(input.toEnvelope(currentTarget, previousTarget));
  }

  return input.sortTargetEnvelopes(targets);
}

export async function projectLatestContentKeyBundle<TBundle>(input: {
  readonly assertTargetsCurrent: (bundle: TBundle) => void;
  readonly getLatestBundle: () => Promise<TBundle | null>;
  readonly metadataIsCurrent: (bundle: TBundle) => boolean;
  readonly refreshForCurrentTargets: (bundle: TBundle) => TBundle | null;
}): Promise<{ readonly bundle: TBundle; readonly stale: boolean } | null> {
  const bundle = await input.getLatestBundle();
  if (!bundle) {
    return null;
  }

  if (!input.metadataIsCurrent(bundle)) {
    const refreshedBundle = input.refreshForCurrentTargets(bundle);
    if (!refreshedBundle) {
      return { bundle, stale: true };
    }
    input.assertTargetsCurrent(refreshedBundle);
    return { bundle: refreshedBundle, stale: false };
  }

  input.assertTargetsCurrent(bundle);
  return { bundle, stale: false };
}

export function currentTargetsCanCarryPreviousBundle<
  TCurrentTarget,
  TEnvelope,
>(input: {
  readonly currentTargets: readonly TCurrentTarget[];
  readonly previousTargets: readonly TEnvelope[];
  readonly targetKey: (target: TCurrentTarget | TEnvelope) => string;
  readonly targetKeyMaterialEqual: (
    previous: TEnvelope,
    current: TCurrentTarget,
  ) => boolean;
}): boolean {
  const currentByTargetKey = new Map(
    input.currentTargets.map((target) => [input.targetKey(target), target]),
  );
  return input.previousTargets.every((previousTarget) => {
    const currentTarget = currentByTargetKey.get(
      input.targetKey(previousTarget),
    );
    return (
      currentTarget !== undefined &&
      input.targetKeyMaterialEqual(previousTarget, currentTarget)
    );
  });
}

interface ContentWriteHeaderInput {
  readonly header: WriteHeader;
  readonly headerHash: string;
}

interface ContentWriteHeaderRow {
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly recordId: string;
}

interface CreateContentWriteHeaderStoreOptions<
  TInput extends ContentWriteHeaderInput,
  TRow extends ContentWriteHeaderRow,
> {
  readonly createConflictError: () => Error;
  readonly createObjectMismatchError: () => Error;
  readonly ensureContentKeyEpoch?:
    | ((contentKeyEpoch: number) => void)
    | undefined;
  readonly expectedObjectKind: WriteHeader["objectKind"];
  readonly getObjectId: (input: TInput) => string;
  readonly getRecordId: (input: TInput) => string;
  readonly insert: (
    input: TInput,
    executor: DatabaseSession,
  ) => Promise<boolean>;
  readonly list: (
    recordIds: readonly string[],
    executor: DatabaseSession,
  ) => Promise<readonly TRow[]>;
  readonly loadHeaderHash: (
    recordId: string,
    executor: DatabaseSession,
  ) => Promise<string | null>;
}

export function createContentWriteHeaderStore<
  TInput extends ContentWriteHeaderInput,
  TRow extends ContentWriteHeaderRow = ContentWriteHeaderRow,
>(options: CreateContentWriteHeaderStoreOptions<TInput, TRow>) {
  return {
    list: async (
      recordIds: readonly string[],
      executor: DatabaseSession,
    ): Promise<Map<string, Omit<TRow, "recordId">>> => {
      const uniqueRecordIds = [...new Set(recordIds)];
      if (uniqueRecordIds.length === 0) {
        return new Map();
      }

      const rows = await options.list(uniqueRecordIds, executor);
      return new Map(
        rows.map((row) => {
          const { recordId, ...stored } = row;
          return [recordId, stored];
        }),
      );
    },
    store: async (input: TInput, executor: DatabaseSession): Promise<void> => {
      if (
        input.header.objectKind !== options.expectedObjectKind ||
        input.header.objectId !== options.getObjectId(input)
      ) {
        throw options.createObjectMismatchError();
      }
      options.ensureContentKeyEpoch?.(input.header.contentKeyEpoch);

      if (await options.insert(input, executor)) {
        return;
      }

      const existingHeaderHash = await options.loadHeaderHash(
        options.getRecordId(input),
        executor,
      );
      if (existingHeaderHash !== input.headerHash) {
        throw options.createConflictError();
      }
    },
  };
}
