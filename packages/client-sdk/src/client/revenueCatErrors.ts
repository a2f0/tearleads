const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;

export class RevenueCatOperationTimeoutError extends Error {
  private restartRequiredValue = false;

  get restartRequired(): boolean {
    return this.restartRequiredValue;
  }

  constructor(
    readonly operationName: string,
    readonly timeoutMs: number,
  ) {
    super(`RevenueCat ${operationName} timed out after ${timeoutMs}ms`);
    this.name = "RevenueCatOperationTimeoutError";
  }

  markRestartRequired(): void {
    this.restartRequiredValue = true;
  }
}

export class RevenueCatCheckoutIdentityPendingError extends Error {
  constructor() {
    super("RevenueCat checkout requires a settled identity");
    this.name = "RevenueCatCheckoutIdentityPendingError";
  }
}

export class RevenueCatCheckoutAbandonedError extends Error {
  constructor() {
    super("RevenueCat checkout preparation was abandoned");
    this.name = "RevenueCatCheckoutAbandonedError";
  }
}

class RevenueCatProviderError extends Error {
  readonly code: unknown;
  readonly storeError: unknown;
  readonly underlyingErrorMessage: unknown;
  readonly userCancelled: unknown;

  constructor(message: string, source: object) {
    super(message, { cause: source });
    this.name = "RevenueCatProviderError";
    this.code = readDiagnosticField(source, "code");
    this.storeError = readDiagnosticField(source, "storeError");
    this.underlyingErrorMessage = readDiagnosticField(
      source,
      "underlyingErrorMessage",
    );
    this.userCancelled = readDiagnosticField(source, "userCancelled");
  }
}

function readDiagnosticField(source: object, field: string): unknown {
  return field in source ? Reflect.get(source, field) : undefined;
}

export function normalizeRevenueCatError(source: unknown): Error {
  if (source instanceof Error) return source;
  const message =
    typeof source === "string"
      ? source
      : typeof source === "object" &&
          source !== null &&
          "message" in source &&
          typeof source.message === "string"
        ? source.message
        : "RevenueCat operation failed";
  return typeof source === "object" && source !== null
    ? new RevenueCatProviderError(message, source)
    : new Error(message, { cause: source });
}

/** Gives each rejected caller its own error without losing subclass identity. */
export function copyRevenueCatError(source: Error): Error {
  // Keep timeout state as ordinary descriptor-backed fields: this clone cannot
  // reproduce JavaScript #private slots.
  const copy: Error = Object.create(
    Object.getPrototypeOf(source),
    Object.getOwnPropertyDescriptors(source),
  );
  return copy;
}

export function revenueCatOperationTimeoutMs(
  configuredTimeoutMs: number | undefined,
): number {
  const timeoutMs = configuredTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      "RevenueCat operation timeout must be a positive finite number",
    );
  }
  return timeoutMs;
}

export function withRevenueCatOperationTimeout<T>(input: {
  readonly operation: () => Promise<T>;
  readonly operationName: string;
  readonly onTimeout?: (error: RevenueCatOperationTimeoutError) => void;
  readonly timeoutMs: number;
}): Promise<T> {
  // The native bridge exposes no cancellation primitive. The deadline releases
  // this caller, while the underlying operation stays serialized until it ends.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new RevenueCatOperationTimeoutError(
        input.operationName,
        input.timeoutMs,
      );
      input.onTimeout?.(error);
      reject(error);
    }, input.timeoutMs);
  });
  return Promise.race([
    Promise.resolve().then(input.operation),
    deadline,
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}
