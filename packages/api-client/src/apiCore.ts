import type { AuthResponse } from '@tearleads/shared';
import { type ApiEventSlug, logApiEvent } from './apiLogger';
import {
  clearStoredAuth,
  getAuthHeaderValue,
  getStoredRefreshToken,
  releaseRefreshLock,
  setSessionExpiredError,
  tryAcquireRefreshLock,
  updateStoredTokens,
  waitForRefreshCompletion
} from './authStorage';
import { isJwtExpired } from './jwt';

export const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

type RefreshOutcome = 'success' | 'rejected' | 'transient';

interface RefreshAttemptResult {
  refreshed: boolean;
  attemptedByThisTab: boolean;
  rejected: boolean;
}

let refreshPromise: Promise<RefreshAttemptResult> | null = null;

/**
 * Core token refresh logic. Makes a single refresh request to the server.
 * Returns 'success' if refresh succeeded, 'rejected' if the server permanently
 * rejected the token (401/403), or 'transient' for temporary failures.
 */
async function executeTokenRefresh(
  refreshToken: string
): Promise<RefreshOutcome> {
  if (!API_BASE_URL) {
    return 'transient';
  }

  const startTime = performance.now();
  let success = false;
  let receivedValidRefreshResponse = false;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (response.status === 401 || response.status === 403) {
      // Permanent failure - token is invalid or session was destroyed
      return 'rejected';
    }

    if (!response.ok) {
      // Transient failure (500, etc) - don't clear auth yet
      return 'transient';
    }

    const data = (await response.json()) as AuthResponse;
    receivedValidRefreshResponse = true;
    updateStoredTokens(data.accessToken, data.refreshToken);
    success = true;
    return 'success';
  } catch (error) {
    console.error('Token refresh attempt failed:', error);
    if (receivedValidRefreshResponse) {
      // Treat storage failures after a successful refresh response as non-fatal.
      // Callers will still fail the retry if no auth header is available.
      return 'success';
    }
    // Transient failure (network error)
    return 'transient';
  } finally {
    const durationMs = performance.now() - startTime;
    void logApiEvent('api_post_auth_refresh', durationMs, success);
  }
}

/**
 * Attempts to refresh the token with cross-tab coordination.
 * Handles the case where another tab may have already refreshed the token.
 */
async function attemptTokenRefresh(): Promise<RefreshAttemptResult> {
  const originalRefreshToken = getStoredRefreshToken();
  if (!originalRefreshToken) {
    return { refreshed: false, attemptedByThisTab: false, rejected: false };
  }

  // Try to acquire the refresh lock. If we fail, it means another tab is
  // already refreshing, so we should wait for it to complete.
  if (!tryAcquireRefreshLock(originalRefreshToken)) {
    // Wait for the other tab to finish.
    const otherTabSucceeded = await waitForRefreshCompletion(
      originalRefreshToken,
      5000
    );
    // If the other tab succeeded, we now have new tokens.
    // If it timed out, we will not proceed to refresh without a lock.
    return {
      refreshed: otherTabSucceeded,
      attemptedByThisTab: false,
      rejected: false
    };
  }

  try {
    // First attempt with the original refresh token
    const outcome = await executeTokenRefresh(originalRefreshToken);
    if (outcome === 'success') {
      return { refreshed: true, attemptedByThisTab: true, rejected: false };
    }

    // First attempt failed - check if another tab already updated the token
    // This handles the race condition where:
    // 1. Tab A reads refresh token X
    // 2. Tab B reads refresh token X
    // 3. Tab A refreshes successfully, gets token Y
    // 4. Tab B's refresh fails (token X was invalidated)
    // 5. Tab B should re-read localStorage and find token Y
    const currentRefreshToken = getStoredRefreshToken();
    if (currentRefreshToken && currentRefreshToken !== originalRefreshToken) {
      // Token was updated by another tab - our refresh "succeeded" via the other tab
      return { refreshed: true, attemptedByThisTab: true, rejected: false };
    }

    // No luck - refresh truly failed
    return {
      refreshed: false,
      attemptedByThisTab: true,
      rejected: outcome === 'rejected'
    };
  } finally {
    releaseRefreshLock();
  }
}

/**
 * Attempts to refresh the token. Returns true if successful.
 * Can be called from SSE or other contexts that don't go through the API wrapper.
 * Uses deduplication to prevent concurrent refresh attempts within the same tab,
 * and cross-tab coordination to handle multiple browser tabs.
 *
 * IMPORTANT: This function only clears auth state when the refresh token is truly
 * expired or invalid across all tabs, not when another tab has already rotated it.
 */
export async function tryRefreshToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = attemptTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  const result = await refreshPromise;
  if (!result.refreshed) {
    // Final check: ensure we didn't miss an update from another tab
    // that happened while we were processing
    const finalToken = getStoredRefreshToken();
    if (!finalToken) {
      // No token at all - session is truly expired
      setSessionExpiredError();
      clearStoredAuth();
    } else if (result.attemptedByThisTab) {
      if (result.rejected || isJwtExpired(finalToken)) {
        // Server permanently rejected the token (401/403), or the JWT itself
        // has expired. Clear auth so the user sees the login form.
        setSessionExpiredError();
        clearStoredAuth();
      }
    }
  }
  return result.refreshed;
}

interface RequestParams {
  fetchOptions?: RequestInit;
  eventName: ApiEventSlug;
  /** Skip token refresh on 401 (e.g., for login requests where 401 means invalid credentials) */
  skipTokenRefresh?: boolean;
}

async function getErrorMessageFromResponse(
  response: Response,
  defaultMessage: string
): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
  } catch {
    // Ignore parsing errors and fall back to the default message
  }
  return defaultMessage;
}

export async function request<T>(
  endpoint: string,
  params: RequestParams
): Promise<T> {
  const response = await requestResponse(endpoint, params);

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

export async function requestResponse(
  endpoint: string,
  params: RequestParams
): Promise<Response> {
  const { fetchOptions, eventName, skipTokenRefresh } = params;

  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const startTime = performance.now();
  let success = false;

  try {
    const authHeaderValue = getAuthHeaderValue();
    const headers = new Headers(fetchOptions?.headers ?? undefined);
    if (authHeaderValue !== null && !headers.has('Authorization')) {
      headers.set('Authorization', authHeaderValue);
    }

    let response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers
    });

    // Handle 401: attempt token refresh and retry once (unless explicitly skipped)
    if (response.status === 401 && !skipTokenRefresh) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        // Get potentially updated auth header after refresh
        const retryAuthHeaderValue = getAuthHeaderValue();
        if (retryAuthHeaderValue === null) {
          // Auth was cleared despite refresh reporting success
          throw new Error('API error: 401');
        }

        const retryHeaders = new Headers(fetchOptions?.headers ?? undefined);
        if (!retryHeaders.has('Authorization')) {
          retryHeaders.set('Authorization', retryAuthHeaderValue);
        }

        response = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...fetchOptions,
          headers: retryHeaders
        });
      }
    }

    if (!response.ok) {
      const defaultMessage = `API error: ${response.status}`;
      throw new Error(
        await getErrorMessageFromResponse(response, defaultMessage)
      );
    }

    success = true;
    return response;
  } finally {
    const durationMs = performance.now() - startTime;
    void logApiEvent(eventName, durationMs, success);
  }
}
