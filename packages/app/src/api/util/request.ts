const BASE_URL = "http://localhost:3001";

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export type HttpMethod = "GET" | "POST";

function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
}

export async function request<T>(
  path: string,
  validator: (value: unknown) => value is T,
  method: HttpMethod,
  body?: string,
): Promise<T> {
  const init: RequestInit = { method, headers: buildHeaders() };
  if (body) {
    init.body = body;
  }
  const response = await fetch(`${BASE_URL}${path}`, init);

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (!validator(data)) {
    throw new Error(`Invalid response shape for ${path}`);
  }

  return data;
}
