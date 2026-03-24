const BASE_URL = "http://localhost:3001";

export async function request<T>(
  path: string,
  validator: (value: unknown) => value is T,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (!validator(data)) {
    throw new Error(`Invalid response shape for ${path}`);
  }

  return data;
}
