import { KeyingVerificationError } from "@tearleads/crypto";
import {
  errorMessage,
  isRefreshableSessionError,
  isReplayableRequestBody,
} from "./requestInternals";
import type { RequestBody, RequestResultOptions } from "./types";

interface SessionRefreshInput {
  readonly authToken: string | null;
  readonly body: RequestBody | undefined;
  readonly code: string | null;
  readonly getCurrentAuthToken: () => string | null;
  readonly isKnownSessionRenewal: (from: string, to: string) => boolean;
  readonly options: RequestResultOptions;
  readonly pendingSessionRenewal: (from: string) => Promise<boolean> | null;
  readonly refreshSession: () => boolean | Promise<boolean>;
  readonly reportError: (message: string) => void;
  readonly responseStatus: number;
}

/**
 * Decides whether a failed request can be replayed after session renewal.
 * Identity-integrity failures are terminal and must retain their typed error.
 */
export async function shouldRetryAfterSessionExpired(
  input: SessionRefreshInput,
): Promise<boolean> {
  if (
    input.options.retryOnSessionExpired === false ||
    !input.authToken ||
    !isReplayableRequestBody(input.body) ||
    !isRefreshableSessionError(input.responseStatus, input.code)
  ) {
    return false;
  }

  const currentAuthToken = input.getCurrentAuthToken();
  let pending: Promise<boolean> | null = null;
  if (currentAuthToken !== input.authToken) {
    const renewed =
      currentAuthToken !== null &&
      input.isKnownSessionRenewal(input.authToken, currentAuthToken);
    if (renewed) {
      input.options.onSessionRenewed?.();
      return true;
    }
    pending = input.pendingSessionRenewal(input.authToken);
    if (!currentAuthToken || !pending) return false;
  }

  let refreshed = false;
  try {
    refreshed = await (pending ?? input.refreshSession());
  } catch (error: unknown) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    if (input.options.reportErrors ?? true) {
      input.reportError(`Session refresh failed: ${errorMessage(error)}`);
    }
  }

  const refreshedToken = input.getCurrentAuthToken();
  const renewed = Boolean(
    refreshed &&
      refreshedToken &&
      input.isKnownSessionRenewal(input.authToken, refreshedToken),
  );
  if (renewed) input.options.onSessionRenewed?.();
  return renewed;
}
