import { tryRefreshToken } from './apiCore';
import { getAuthHeaderValue } from './authStorage';

function withAuthorizationHeader(
  headersInit: HeadersInit | undefined
): Headers {
  const headers = new Headers(headersInit);
  if (headers.has('Authorization')) {
    return headers;
  }

  const authHeaderValue = getAuthHeaderValue();
  if (authHeaderValue !== null) {
    headers.set('Authorization', authHeaderValue);
  }

  return headers;
}

export async function fetchWithAuthRefresh(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const firstAttemptInit: RequestInit = {
    ...init,
    headers: withAuthorizationHeader(init.headers)
  };
  let response = await fetchImpl(input, firstAttemptInit);
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await tryRefreshToken();
  if (!refreshed) {
    return response;
  }

  const retryInit: RequestInit = {
    ...init,
    headers: withAuthorizationHeader(init.headers)
  };
  response = await fetchImpl(input, retryInit);
  return response;
}
