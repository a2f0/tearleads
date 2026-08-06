import { PurchaseAbortedError } from "./purchaseErrors";

interface RevenueCatPurchasePreparationBackend {
  preparePurchasePackage?(input: {
    packageId: string;
    abortSignal?: AbortSignal;
  }): Promise<unknown>;
  setAttributes(attributes: Record<string, string | null>): Promise<void>;
}

export async function prepareRevenueCatPurchase(input: {
  readonly abortSignal: AbortSignal | undefined;
  readonly attributes: Record<string, string>;
  readonly backend: RevenueCatPurchasePreparationBackend;
  readonly packageId: string;
}): Promise<unknown> {
  try {
    await input.backend.setAttributes(input.attributes);
    if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
    return await input.backend.preparePurchasePackage?.({
      packageId: input.packageId,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
  } catch (error) {
    if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
    throw error;
  }
}
