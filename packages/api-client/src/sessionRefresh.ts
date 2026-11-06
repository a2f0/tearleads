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
 * Checks for a renewal that another request already started or finished: a
 * boolean is the final answer, otherwise `pending` (null when none) is awaited.
 */
function concurrentRenewal(
  input: SessionRefreshInput,
  authToken: string,
): boolean | { readonly pending: Promise<boolean> | null } {
  const currentAuthToken = input.getCurrentAuthToken();
  if (currentAuthToken === authToken) return { pending: null };
  const renewed =
    currentAuthToken !== null &&
    input.isKnownSessionRenewal(authToken, currentAuthToken);
  if (renewed) {
    input.options.onSessionRenewed?.();
    return true;
  }
  const pending = input.pendingSessionRenewal(authToken);
  if (!currentAuthToken || !pending) return false;
  return { pending };
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

  const concurrent = concurrentRenewal(input, input.authToken);
  if (typeof concurrent === "boolean") return concurrent;
  const pending = concurrent.pending;

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
