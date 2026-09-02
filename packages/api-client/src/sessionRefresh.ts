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
  readonly options: RequestResultOptions;
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
  if (currentAuthToken && currentAuthToken !== input.authToken) {
    return true;
  }

  let refreshed = false;
  try {
    refreshed = await input.refreshSession();
  } catch (error: unknown) {
    if (error instanceof KeyingVerificationError) {
      throw error;
    }
    if (input.options.reportErrors ?? true) {
      input.reportError(`Session refresh failed: ${errorMessage(error)}`);
    }
  }

  return Boolean(
    refreshed &&
      input.getCurrentAuthToken() &&
      input.getCurrentAuthToken() !== input.authToken,
  );
}
