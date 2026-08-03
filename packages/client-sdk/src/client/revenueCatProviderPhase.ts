import type { RevenueCatOperationTimeoutError } from "./revenueCatErrors";
import type { RevenueCatTimeoutCoordinator } from "./revenueCatTimeoutCoordinator";

interface RevenueCatProviderPhaseInput {
  readonly buyerPaced?: boolean;
  readonly operationName: string;
}

export interface RevenueCatProviderPhaseControl {
  run<T>(
    operation: () => Promise<T>,
    input: RevenueCatProviderPhaseInput,
  ): Promise<T>;
}

/** Bounds provider phases while their serialized non-provider tail remains held. */
export class RevenueCatProviderPhaseCoordinator
  implements RevenueCatProviderPhaseControl
{
  readonly timedOut: Promise<never>;
  private rejectTimedOut = (_error: RevenueCatOperationTimeoutError) => {};

  constructor(private readonly timeouts: RevenueCatTimeoutCoordinator) {
    this.timedOut = new Promise<never>((_resolve, reject) => {
      this.rejectTimedOut = reject;
    });
    void this.timedOut.catch(() => undefined);
  }

  async run<T>(
    operation: () => Promise<T>,
    input: RevenueCatProviderPhaseInput,
  ): Promise<T> {
    const pending = Promise.resolve().then(operation);
    if (input.buyerPaced) return pending;
    let timeoutError: RevenueCatOperationTimeoutError | undefined;
    try {
      return await this.timeouts.withProviderTimeout(
        pending,
        input.operationName,
        () => true,
        (error) => {
          timeoutError = error;
          this.rejectTimedOut(error);
        },
      );
    } catch (error) {
      // The caller gets the timeout through `timedOut`; keep this serialized
      // operation held until the native bridge actually settles.
      if (error === timeoutError) await pending.catch(() => undefined);
      throw error;
    }
  }
}
