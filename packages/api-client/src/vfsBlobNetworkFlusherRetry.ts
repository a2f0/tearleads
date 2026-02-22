import type {
  VfsBlobFailureClass,
  VfsBlobNetworkRetryPolicy
} from './vfsBlobNetworkFlusherTypes';

const DEFAULT_RETRY_POLICY: VfsBlobNetworkRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 2_000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504]
};

export function normalizeRetryPolicy(
  input: Partial<VfsBlobNetworkRetryPolicy> | undefined
): VfsBlobNetworkRetryPolicy {
  const maxAttempts = normalizePositiveInteger(
    input?.maxAttempts,
    DEFAULT_RETRY_POLICY.maxAttempts
  );
  const initialDelayMs = normalizeNonNegativeInteger(
    input?.initialDelayMs,
    DEFAULT_RETRY_POLICY.initialDelayMs
  );
  const maxDelayMs = normalizeNonNegativeInteger(
    input?.maxDelayMs,
    DEFAULT_RETRY_POLICY.maxDelayMs
  );
  const backoffMultiplier = normalizePositiveNumber(
    input?.backoffMultiplier,
    DEFAULT_RETRY_POLICY.backoffMultiplier
  );
  const retryableStatusCodes = normalizeRetryableStatusCodes(
    input?.retryableStatusCodes ?? DEFAULT_RETRY_POLICY.retryableStatusCodes
  );

  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs: Math.max(maxDelayMs, initialDelayMs),
    backoffMultiplier,
    retryableStatusCodes
  };
}

export function isRetryableBlobOperationError(
  error: unknown,
  retryPolicy: VfsBlobNetworkRetryPolicy
): boolean {
  return getBlobOperationErrorInfo(error, retryPolicy).retryable;
}

export async function defaultRetrySleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export interface BlobOperationErrorInfo {
  failureClass: VfsBlobFailureClass;
  statusCode?: number | undefined;
  retryable: boolean;
}

export function getBlobOperationErrorInfo(
  error: unknown,
  retryPolicy: VfsBlobNetworkRetryPolicy
): BlobOperationErrorInfo {
  const statusCode = getHttpStatus(error);
  if (statusCode !== null) {
    return {
      failureClass: 'http_status',
      statusCode,
      retryable: retryPolicy.retryableStatusCodes.includes(statusCode)
    };
  }

  if (error instanceof TypeError) {
    return {
      failureClass: 'network',
      retryable: true
    };
  }

  return {
    failureClass: 'unknown',
    retryable: false
  };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fallback;
  }
  return value;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeRetryableStatusCodes(input: unknown): number[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_RETRY_POLICY.retryableStatusCodes];
  }

  const normalized = input.filter((value): value is number => {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 100 &&
      value <= 599
    );
  });

  if (normalized.length === 0) {
    return [...DEFAULT_RETRY_POLICY.retryableStatusCodes];
  }

  return normalized;
}

function getHttpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const status = Reflect.get(error, 'status');
  if (typeof status !== 'number' || !Number.isInteger(status)) {
    return null;
  }

  return status;
}
